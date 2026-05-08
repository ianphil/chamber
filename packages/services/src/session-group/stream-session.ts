import { randomUUID } from 'node:crypto';
import type { MindContext } from '@chamber/shared/types';
import type { ChatroomStreamEvent, OrchestrationMode, ChatroomMessage } from '@chamber/shared/chatroom-types';
import type { OrchestrationContext } from './orchestrators/legacy-types';
import type { CopilotSession } from '../mind';
import { isStaleSessionError, SEND_TIMEOUT_MS, DEFAULT_TURN_TIMEOUT_MS, sendTimeoutError } from '@chamber/shared/sessionErrors';
import { getCurrentDateTimeContext, injectCurrentDateTimeContext } from '../chat/currentDateTimeContext';
import {
  SdkChatEventContractError,
  getSdkSessionErrorMessage,
  mapSdkAssistantMessage,
  mapSdkAssistantMessageDelta,
  mapSdkAssistantReasoningDelta,
  mapSdkToolExecutionComplete,
  mapSdkToolExecutionPartialResult,
  mapSdkToolExecutionProgress,
  mapSdkToolExecutionStart,
} from '../sdk/sdkChatEventMapper';

// ---------------------------------------------------------------------------
// TurnTimeoutError — distinguishable timeout for callers
// ---------------------------------------------------------------------------

export class TurnTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`Agent turn timed out after ${timeoutMs}ms`);
    this.name = 'TurnTimeoutError';
  }
}

// ---------------------------------------------------------------------------
// streamAgentTurn — shared SDK event wiring for all orchestration strategies
// ---------------------------------------------------------------------------

export interface StreamAgentOptions {
  session: CopilotSession;
  mind: MindContext;
  prompt: string;
  roundId: string;
  context: OrchestrationContext;
  abortSignal: AbortSignal;
  unsubs: (() => void)[];
  orchestrationMode: OrchestrationMode;
  /** If true, suppress all renderer-visible events (chunks, tool calls, etc.) */
  silent?: boolean;
  /** Max ms to wait for session.idle before rejecting with TurnTimeoutError (default: 300_000) */
  turnTimeout?: number;
}

export interface StreamAgentResult {
  /** Raw final content from the assistant (empty string if no content) */
  finalContent: string;
  /** The message ID used for this turn */
  messageId: string;
}

/**
 * Wire all SDK event listeners, send the prompt, and wait for idle.
 * Returns the raw final content — callers handle message creation and persistence.
 */
export async function streamAgentTurn(opts: StreamAgentOptions): Promise<StreamAgentResult> {
  const { session, mind, prompt, roundId, context, abortSignal, unsubs } = opts;
  const messageId = randomUUID();

  const emitEvent = (event: ChatroomStreamEvent['event']) => {
    if (!abortSignal.aborted && !opts.silent) {
      context.emitEvent({
        mindId: mind.mindId,
        mindName: mind.identity.name,
        messageId,
        roundId,
        event,
      } satisfies ChatroomStreamEvent);
    }
  };

  let finalContent = '';
  let sdkContractFailed = false;
  let rejectTurnDone: ((error: Error) => void) | undefined;
  let turnDoneTimeoutId: ReturnType<typeof setTimeout> | undefined;
  const failSdkContract = (error: unknown) => {
    if (abortSignal.aborted || sdkContractFailed) return;
    sdkContractFailed = true;
    const message = error instanceof SdkChatEventContractError
      ? error.message
      : 'SDK contract mismatch while streaming chatroom turn';
    clearTimeout(turnDoneTimeoutId);
    emitEvent({ type: 'error', message });
    void session.abort().catch(() => undefined);
    rejectTurnDone?.(error instanceof Error ? error : new Error(message));
  };
  const emitMapped = (mapper: () => ChatroomStreamEvent['event'] | null, afterMap?: (event: ChatroomStreamEvent['event']) => void) => {
    try {
      const mapped = mapper();
      if (!mapped) return;
      afterMap?.(mapped);
      emitEvent(mapped);
    } catch (error) {
      failSdkContract(error);
    }
  };

  unsubs.push(
    session.on('assistant.message_delta', (e) => {
      emitMapped(() => mapSdkAssistantMessageDelta(e));
    }),
  );

  unsubs.push(
    session.on('assistant.message', (e) => {
      emitMapped(
        () => mapSdkAssistantMessage(e),
        (event) => {
          if (event.type === 'message_final') {
            finalContent = event.content;
          }
        },
      );
    }),
  );

  unsubs.push(
    session.on('assistant.reasoning_delta', (e) => {
      emitMapped(() => mapSdkAssistantReasoningDelta(e));
    }),
  );

  unsubs.push(
    session.on('tool.execution_start', (e) => {
      emitMapped(() => mapSdkToolExecutionStart(e));
    }),
  );

  unsubs.push(
    session.on('tool.execution_progress', (e) => {
      emitMapped(() => mapSdkToolExecutionProgress(e));
    }),
  );

  unsubs.push(
    session.on('tool.execution_partial_result', (e) => {
      emitMapped(() => mapSdkToolExecutionPartialResult(e));
    }),
  );

  unsubs.push(
    session.on('tool.execution_complete', (e) => {
      emitMapped(() => mapSdkToolExecutionComplete(e));
    }),
  );

  // Set up idle/error listeners BEFORE send to avoid missing events.
  // The turnDone timeout ID is hoisted so it can be cleared on any exit path
  // (send timeout, abort, or normal completion) to prevent 5-minute timer leaks.
  const turnTimeoutMs = opts.turnTimeout ?? DEFAULT_TURN_TIMEOUT_MS;
  const turnDone = new Promise<void>((resolve, reject) => {
    rejectTurnDone = reject;
    turnDoneTimeoutId = setTimeout(
      () => reject(new TurnTimeoutError(turnTimeoutMs)),
      turnTimeoutMs,
    );

    const unsubIdle = session.on('session.idle', () => {
      clearTimeout(turnDoneTimeoutId);
      unsubIdle();
      resolve();
    });
    unsubs.push(unsubIdle);

    const unsubError = session.on('session.error', (e) => {
      clearTimeout(turnDoneTimeoutId);
      unsubError();
      try {
        reject(new Error(getSdkSessionErrorMessage(e)));
      } catch (error) {
        failSdkContract(error);
      }
    });
    unsubs.push(unsubError);

    abortSignal.addEventListener('abort', () => {
      clearTimeout(turnDoneTimeoutId);
      resolve();
    }, { once: true });
  });

  let sendTimerId: ReturnType<typeof setTimeout> | undefined;
  const sendTimeout = new Promise<never>((_, reject) => {
    sendTimerId = setTimeout(() => reject(sendTimeoutError()), SEND_TIMEOUT_MS);
  });
  try {
    await Promise.race([session.send({ prompt: injectCurrentDateTimeContext(prompt, getCurrentDateTimeContext()) }), sendTimeout]);
  } catch (err) {
    // Send failed (e.g. 30s timeout) — clear the turnDone timer to prevent leak
    clearTimeout(turnDoneTimeoutId);
    throw err;
  } finally {
    clearTimeout(sendTimerId);
  }

  await turnDone.catch((err) => {
    if (sdkContractFailed) throw err;
    // Emit a discriminated event so the renderer clears the streaming state and
    // can render timeout-specific UI without parsing error messages.
    if (err instanceof TurnTimeoutError) {
      emitEvent({ type: 'timeout', timeoutMs: err.timeoutMs });
    } else {
      emitEvent({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
    throw err;
  });

  return { finalContent, messageId };
}

// ---------------------------------------------------------------------------
// sendToAgentWithRetry — stale session retry wrapper
// ---------------------------------------------------------------------------

export interface SendToAgentOptions {
  mind: MindContext;
  prompt: string;
  roundId: string;
  context: OrchestrationContext;
  abortSignal: AbortSignal;
  unsubs: (() => void)[];
  orchestrationMode: OrchestrationMode;
  /** Optional content transform (e.g. stripControlJson) applied to display content */
  transformContent?: (raw: string) => string;
  /** If true, do not persist message or emit done — used for internal coordinator calls */
  silent?: boolean;
  /** Max ms to wait for session.idle before rejecting with TurnTimeoutError */
  turnTimeout?: number;
}

export interface SendToAgentResult {
  /** The persisted ChatroomMessage, or null if aborted/empty */
  message: ChatroomMessage | null;
  /** Raw final content (before transform) — useful for parsing control directives */
  rawContent: string;
}

/**
 * Get-or-create a session, stream a turn, persist the result.
 * Retries once on stale session errors.
 */
export async function sendToAgentWithRetry(opts: SendToAgentOptions): Promise<SendToAgentResult> {
  const { mind, prompt, roundId, context, abortSignal, orchestrationMode, transformContent } = opts;

  const run = async (session: CopilotSession): Promise<SendToAgentResult> => {
    try {
      const { finalContent, messageId } = await streamAgentTurn({
        session, mind, prompt, roundId, context,
        abortSignal, unsubs: opts.unsubs, orchestrationMode,
        silent: opts.silent,
        turnTimeout: opts.turnTimeout,
      });

      if (abortSignal.aborted) return { message: null, rawContent: finalContent };

      if (finalContent) {
        const displayContent = transformContent ? transformContent(finalContent) : finalContent;
        const msg: ChatroomMessage = {
          id: messageId,
          role: 'assistant',
          blocks: [{ type: 'text', content: displayContent || finalContent }],
          timestamp: Date.now(),
          sender: { mindId: mind.mindId, name: mind.identity.name },
          roundId,
          orchestrationMode,
        };

        if (!opts.silent) {
          context.persistMessage(msg);

          if (!abortSignal.aborted) {
            context.emitEvent({
              mindId: mind.mindId,
              mindName: mind.identity.name,
              messageId,
              roundId,
              event: { type: 'done' },
            });
          }
        }

        return {
          message: msg,
          rawContent: finalContent,
        };
      }

      return { message: null, rawContent: '' };
    } finally {
      for (const unsub of opts.unsubs) unsub();
      opts.unsubs.length = 0;
    }
  };

  const session = await context.getOrCreateSession(mind.mindId);
  try {
    return await run(session);
  } catch (err) {
    if (!isStaleSessionError(err)) throw err;
    context.evictSession(mind.mindId);
    const freshSession = await context.getOrCreateSession(mind.mindId);
    return await run(freshSession);
  }
}
