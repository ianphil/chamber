import type { z } from 'zod';
import { fromZodError, IpcValidationError } from '../../contracts/errors';
import { isElectronOnlyChannel, isWsRejectedChannel } from './channelClassification';

/**
 * Opaque handle identifying the caller (a live WebSocket or the webContents
 * that originated an IPC invoke). Handlers that need per-caller state
 * (subscriptions, etc.) use this as an identity key — never serialize it
 * across the wire.
 */
export type CallerHandle = unknown;

export type Transport = 'ipc' | 'ws';

/**
 * Caller-scoped reply channel. Emits are routed only to the invoker:
 * the webContents that issued the IPC invoke, or the WebSocket that
 * sent the JSON-RPC request. For broadcasts, use {@link PushBus}.
 */
export interface InvocationReply {
  emit(channel: string, payload: unknown): void;
}

export interface InvocationCtx {
  readonly reply: InvocationReply;
  readonly senderHandle: CallerHandle;
  readonly transport: Transport;
}

type AnyTuple = z.ZodTuple;

type Handler<Schema extends AnyTuple, R> = (
  args: z.infer<Schema>,
  ctx: InvocationCtx,
) => R | Promise<R>;

interface Registration {
  schema: AnyTuple;
  handler: Handler<AnyTuple, unknown>;
}

/**
 * Thrown when a caller invokes an unknown method, or when a WS caller
 * invokes a method classified as electron-only.
 *
 * Maps to JSON-RPC `-32601` in the WS transport.
 */
export class DispatcherMethodNotFound extends Error {
  readonly code = 'METHOD_NOT_FOUND';
  readonly channel: string;
  constructor(channel: string, reason: 'unknown' | 'electron-only' | 'ws-unsupported' = 'unknown') {
    super(
      reason === 'unknown'
        ? `method not found: ${channel}`
        : `method not available on this transport: ${channel}`,
    );
    this.name = 'DispatcherMethodNotFound';
    this.channel = channel;
  }
}

/**
 * Channel-agnostic handler table. Both transports (IPC adapters and the
 * WS server) register the same handlers here; validation and electron-
 * boundary enforcement happen at the dispatcher — not duplicated per
 * transport.
 *
 * Handlers receive positional args (matching the existing `z.ZodTuple`
 * contract shape) plus an {@link InvocationCtx} carrying a reply-only
 * emit channel. For broadcasts, handlers take a {@link PushBus} via
 * closure at registration time.
 */
export class Dispatcher {
  private readonly handlers = new Map<string, Registration>();

  register<Schema extends AnyTuple, R>(
    channel: string,
    schema: Schema,
    handler: Handler<Schema, R>,
  ): void {
    if (this.handlers.has(channel)) {
      throw new Error(`Dispatcher: channel already registered: ${channel}`);
    }
    this.handlers.set(channel, {
      schema,
      handler: handler as unknown as Handler<AnyTuple, unknown>,
    });
  }

  has(channel: string): boolean {
    return this.handlers.has(channel);
  }

  channels(): readonly string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Invokes a registered handler. Resolves with the handler's result or
   * rejects with one of:
   *   - {@link DispatcherMethodNotFound} (unknown channel, or WS caller hit an
   *     electron-only channel) — WS transport maps to `-32601`
   *   - {@link IpcValidationError} (args failed schema) — WS transport maps
   *     to `-32602`, IPC callers see the error directly
   *   - whatever the handler throws — WS transport maps to `-32603` with a
   *     sanitized message
   */
  async invoke(channel: string, args: unknown[], ctx: InvocationCtx): Promise<unknown> {
    const reg = this.handlers.get(channel);
    if (!reg) {
      throw new DispatcherMethodNotFound(channel, 'unknown');
    }
    if (ctx.transport === 'ws' && isWsRejectedChannel(channel)) {
      throw new DispatcherMethodNotFound(
        channel,
        isElectronOnlyChannel(channel) ? 'electron-only' : 'ws-unsupported',
      );
    }
    const parsed = reg.schema.safeParse(args);
    if (!parsed.success) {
      throw fromZodError(channel, parsed.error);
    }
    return reg.handler(parsed.data as never, ctx);
  }
}

export { IpcValidationError };
