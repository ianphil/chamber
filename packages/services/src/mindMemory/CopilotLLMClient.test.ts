/**
 * Phase 8 — CopilotLLMClient adapter unit tests.
 *
 * The adapter is decoupled from the real Copilot SDK: it consumes a
 * `createOneShotSession` factory through `deps`. These tests drive a fake
 * factory and assert the five locked behaviours from the Phase 8 brief:
 *   1. Tools / permission surface left to the factory (adapter never
 *      installs an approval handler and never asks the factory to register
 *      tools — it simply forwards mindId / mindPath / signal).
 *   2. Timeout-bounded via an internal AbortController; on expiry rejects
 *      with `Error('LLM synthesis timed out after Xms')` and aborts the
 *      session signal.
 *   3. No conversation history mutation — fresh session per call, never
 *      reused.
 *   4. Error propagation — non-timeout errors propagate verbatim.
 *   5. Always closes the session, even on timeout / synthesis failure.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createCopilotLLMClient,
  type CreateOneShotSessionArgs,
  type OneShotSession,
} from './CopilotLLMClient';

interface FakeSession extends OneShotSession {
  closed: boolean;
  signal: AbortSignal;
}

interface FakeFactoryOptions {
  send?: (prompt: string, signal: AbortSignal) => Promise<string>;
  closeError?: Error;
  factoryError?: Error;
}

interface FakeFactoryHandle {
  factory: (args: CreateOneShotSessionArgs) => Promise<OneShotSession>;
  calls: CreateOneShotSessionArgs[];
  sessions: FakeSession[];
}

function makeFakeFactory(options: FakeFactoryOptions = {}): FakeFactoryHandle {
  const calls: CreateOneShotSessionArgs[] = [];
  const sessions: FakeSession[] = [];
  const factory = async (args: CreateOneShotSessionArgs): Promise<OneShotSession> => {
    calls.push(args);
    if (options.factoryError) throw options.factoryError;
    const session: FakeSession = {
      closed: false,
      signal: args.signal,
      async send(prompt: string): Promise<string> {
        if (options.send) return options.send(prompt, args.signal);
        return `echo:${prompt}`;
      },
      async close(): Promise<void> {
        this.closed = true;
        if (options.closeError) throw options.closeError;
      },
    };
    sessions.push(session);
    return session;
  };
  return { factory, calls, sessions };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createCopilotLLMClient', () => {
  it('forwards mindId, mindPath, and an AbortSignal to the session factory', async () => {
    const handle = makeFakeFactory();
    const client = createCopilotLLMClient({
      mindId: 'mind-alpha',
      mindPath: '/tmp/minds/alpha',
      deps: { createOneShotSession: handle.factory },
    });

    const result = await client.synthesize({ prompt: 'hello', timeoutMs: 1_000 });

    expect(result).toBe('echo:hello');
    expect(handle.calls).toHaveLength(1);
    expect(handle.calls[0].mindId).toBe('mind-alpha');
    expect(handle.calls[0].mindPath).toBe('/tmp/minds/alpha');
    expect(handle.calls[0].signal).toBeInstanceOf(AbortSignal);
    expect(handle.calls[0].signal.aborted).toBe(false);
  });

  it('does not surface a permission handler or tool registration to the factory', async () => {
    // The adapter's args interface only carries mindId, mindPath, signal.
    // Asserting the keys explicitly catches accidental drift that would
    // open a back-door for tools or approval flow.
    const handle = makeFakeFactory();
    const client = createCopilotLLMClient({
      mindId: 'mind-alpha',
      mindPath: '/tmp/minds/alpha',
      deps: { createOneShotSession: handle.factory },
    });

    await client.synthesize({ prompt: 'p', timeoutMs: 1_000 });

    const args = handle.calls[0] as unknown as Record<string, unknown>;
    expect(Object.keys(args).sort()).toEqual(['mindId', 'mindPath', 'signal']);
    expect(args.tools).toBeUndefined();
    expect(args.onPermissionRequest).toBeUndefined();
  });

  it('creates a fresh session for every synthesize call (no history mutation)', async () => {
    const handle = makeFakeFactory();
    const client = createCopilotLLMClient({
      mindId: 'm', mindPath: '/m', deps: { createOneShotSession: handle.factory },
    });

    await client.synthesize({ prompt: 'one', timeoutMs: 1_000 });
    await client.synthesize({ prompt: 'two', timeoutMs: 1_000 });

    expect(handle.sessions).toHaveLength(2);
    expect(handle.sessions[0]).not.toBe(handle.sessions[1]);
    expect(handle.sessions[0].closed).toBe(true);
    expect(handle.sessions[1].closed).toBe(true);
  });

  it('rejects with a timeout error and aborts the signal when timeoutMs elapses', async () => {
    const handle = makeFakeFactory({
      send: (_prompt, signal) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
    });
    const client = createCopilotLLMClient({
      mindId: 'm', mindPath: '/m', deps: { createOneShotSession: handle.factory },
    });

    const promise = client.synthesize({ prompt: 'p', timeoutMs: 250 });
    // Attach catch handler before advancing timers to avoid an
    // unhandled-rejection race when the timer fires synchronously.
    const settled = promise.catch((e: unknown) => e as Error);

    await vi.advanceTimersByTimeAsync(250);
    const err = await settled;

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('LLM synthesis timed out after 250ms');
    expect(handle.sessions[0].signal.aborted).toBe(true);
    expect(handle.sessions[0].closed).toBe(true);
  });

  it('propagates non-timeout SDK errors verbatim', async () => {
    const handle = makeFakeFactory({
      send: async () => { throw new Error('SDK exploded'); },
    });
    const client = createCopilotLLMClient({
      mindId: 'm', mindPath: '/m', deps: { createOneShotSession: handle.factory },
    });

    await expect(client.synthesize({ prompt: 'p', timeoutMs: 1_000 }))
      .rejects.toThrow('SDK exploded');

    expect(handle.sessions[0].closed).toBe(true);
  });

  it('propagates errors from the factory itself and does not try to close a missing session', async () => {
    const handle = makeFakeFactory({
      factoryError: new Error('cannot start CLI'),
    });
    const client = createCopilotLLMClient({
      mindId: 'm', mindPath: '/m', deps: { createOneShotSession: handle.factory },
    });

    await expect(client.synthesize({ prompt: 'p', timeoutMs: 1_000 }))
      .rejects.toThrow('cannot start CLI');
    expect(handle.sessions).toHaveLength(0);
  });

  it('always closes the session in `finally`, even when send throws', async () => {
    const handle = makeFakeFactory({
      send: async () => { throw new Error('boom'); },
    });
    const client = createCopilotLLMClient({
      mindId: 'm', mindPath: '/m', deps: { createOneShotSession: handle.factory },
    });

    await expect(client.synthesize({ prompt: 'p', timeoutMs: 1_000 })).rejects.toThrow('boom');
    expect(handle.sessions[0].closed).toBe(true);
  });

  it('swallows close() failures so they do not mask synthesis success', async () => {
    const handle = makeFakeFactory({ closeError: new Error('close bombed') });
    const client = createCopilotLLMClient({
      mindId: 'm', mindPath: '/m', deps: { createOneShotSession: handle.factory },
    });

    await expect(client.synthesize({ prompt: 'p', timeoutMs: 1_000 })).resolves.toBe('echo:p');
    expect(handle.sessions[0].closed).toBe(true);
  });

  it('clears the timeout timer on the success path', async () => {
    const handle = makeFakeFactory();
    const client = createCopilotLLMClient({
      mindId: 'm', mindPath: '/m', deps: { createOneShotSession: handle.factory },
    });

    await client.synthesize({ prompt: 'p', timeoutMs: 5_000 });
    // If the timer were still pending, advancing the clock would flip
    // the aborted bit on the session signal we kept a reference to.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(handle.sessions[0].signal.aborted).toBe(false);
  });
});
