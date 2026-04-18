import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock node:crypto for UUID generation
const mockRandomUUID = vi.fn(() => 'test-uuid');
vi.mock('node:crypto', () => ({
  randomUUID: (...args: unknown[]) => mockRandomUUID(...args),
}));

import { streamAgentTurn, sendToAgentWithRetry } from './stream-agent';
import type { StreamAgentOptions, SendToAgentOptions } from './stream-agent';
import type { OrchestrationContext } from './types';
import type { MindContext } from '../../../../shared/types';
import type { ChatroomStreamEvent, ChatroomMessage } from '../../../../shared/chatroom-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockSession() {
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  return {
    send: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, []);
      const list = listeners.get(event);
      if (!list) throw new Error('expected listener list');
      list.push(cb);
      const unsub = vi.fn(() => {
        const cbs = listeners.get(event);
        if (cbs) {
          const idx = cbs.indexOf(cb);
          if (idx >= 0) cbs.splice(idx, 1);
        }
      });
      return unsub;
    }),
    _emit(event: string, data: unknown) {
      for (const cb of listeners.get(event) ?? []) cb(data);
    },
    _listeners: listeners,
  };
}

type MockSession = ReturnType<typeof createMockSession>;

function makeMind(id: string, name: string): MindContext {
  return {
    mindId: id,
    mindPath: `/minds/${id}`,
    identity: { name, systemMessage: `I am ${name}` },
    status: 'ready',
  };
}

function createContext(
  sessions: Map<string, MockSession>,
  overrides?: Partial<OrchestrationContext>,
): OrchestrationContext {
  const events: ChatroomStreamEvent[] = [];
  const messages: ChatroomMessage[] = [];
  return {
    getOrCreateSession: vi.fn(async (mindId: string) => {
      if (!sessions.has(mindId)) sessions.set(mindId, createMockSession());
      return sessions.get(mindId)!;
    }),
    evictSession: vi.fn((mindId: string) => {
      sessions.delete(mindId);
    }),
    buildBasePrompt: vi.fn(() => 'test prompt'),
    emitEvent: vi.fn((event: ChatroomStreamEvent) => events.push(event)),
    persistMessage: vi.fn((msg: ChatroomMessage) => messages.push(msg)),
    getHistory: vi.fn(() => []),
    orchestrationMode: 'concurrent',
    ...overrides,
  };
}

function autoIdle(session: MockSession) {
  session.send.mockImplementation(async () => {
    setTimeout(() => {
      session._emit('assistant.message', {
        data: { messageId: 'sdk-msg-1', content: 'Hello from agent' },
      });
      session._emit('session.idle', {});
    }, 0);
  });
}

const mind = makeMind('dude', 'The Dude');

let uuidCounter = 0;
function resetUUIDs() {
  uuidCounter = 0;
  mockRandomUUID.mockImplementation(() => `uuid-${++uuidCounter}`);
}

function makeStreamOpts(
  session: MockSession,
  overrides?: Partial<StreamAgentOptions>,
): StreamAgentOptions {
  return {
    session: session as unknown as StreamAgentOptions['session'],
    mind,
    prompt: 'Hello',
    roundId: 'round-1',
    context: createContext(new Map()),
    abortSignal: new AbortController().signal,
    unsubs: [],
    orchestrationMode: 'concurrent',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// streamAgentTurn
// ---------------------------------------------------------------------------

describe('streamAgentTurn', () => {
  let sessions: Map<string, MockSession>;

  beforeEach(() => {
    vi.clearAllMocks();
    resetUUIDs();
    sessions = new Map();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits chunk events on assistant.message_delta', async () => {
    const sess = createMockSession();
    const ctx = createContext(sessions);
    const unsubs: (() => void)[] = [];

    sess.send.mockImplementation(async () => {
      setTimeout(() => {
        sess._emit('assistant.message_delta', {
          data: { messageId: 'sdk-1', deltaContent: 'partial' },
        });
        sess._emit('session.idle', {});
      }, 0);
    });

    await streamAgentTurn(makeStreamOpts(sess, { context: ctx, unsubs }));

    const events = (ctx.emitEvent as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0] as ChatroomStreamEvent,
    );
    const chunks = events.filter((e) => e.event.type === 'chunk');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].event).toMatchObject({ type: 'chunk', content: 'partial', sdkMessageId: 'sdk-1' });
  });

  it('emits message_final on assistant.message and captures finalContent', async () => {
    const sess = createMockSession();
    const ctx = createContext(sessions);

    sess.send.mockImplementation(async () => {
      setTimeout(() => {
        sess._emit('assistant.message', {
          data: { messageId: 'sdk-2', content: 'Final answer' },
        });
        sess._emit('session.idle', {});
      }, 0);
    });

    const result = await streamAgentTurn(makeStreamOpts(sess, { context: ctx }));

    expect(result.finalContent).toBe('Final answer');
    const events = (ctx.emitEvent as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0] as ChatroomStreamEvent,
    );
    const finals = events.filter((e) => e.event.type === 'message_final');
    expect(finals).toHaveLength(1);
    expect(finals[0].event).toMatchObject({ type: 'message_final', content: 'Final answer' });
  });

  it('emits tool events (tool_start, tool_progress, tool_output, tool_done)', async () => {
    const sess = createMockSession();
    const ctx = createContext(sessions);

    sess.send.mockImplementation(async () => {
      setTimeout(() => {
        sess._emit('tool.execution_start', {
          data: { toolCallId: 'tc-1', toolName: 'grep', arguments: '{}', parentToolCallId: undefined },
        });
        sess._emit('tool.execution_progress', {
          data: { toolCallId: 'tc-1', progressMessage: 'searching...' },
        });
        sess._emit('tool.execution_partial_result', {
          data: { toolCallId: 'tc-1', partialOutput: 'found it' },
        });
        sess._emit('tool.execution_complete', {
          data: { toolCallId: 'tc-1', success: true, result: { content: 'done' }, error: undefined },
        });
        sess._emit('session.idle', {});
      }, 0);
    });

    await streamAgentTurn(makeStreamOpts(sess, { context: ctx }));

    const events = (ctx.emitEvent as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0] as ChatroomStreamEvent,
    );
    const types = events.map((e) => e.event.type);
    expect(types).toContain('tool_start');
    expect(types).toContain('tool_progress');
    expect(types).toContain('tool_output');
    expect(types).toContain('tool_done');
  });

  it('emits reasoning events', async () => {
    const sess = createMockSession();
    const ctx = createContext(sessions);

    sess.send.mockImplementation(async () => {
      setTimeout(() => {
        sess._emit('assistant.reasoning_delta', {
          data: { reasoningId: 'r-1', deltaContent: 'thinking...' },
        });
        sess._emit('session.idle', {});
      }, 0);
    });

    await streamAgentTurn(makeStreamOpts(sess, { context: ctx }));

    const events = (ctx.emitEvent as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0] as ChatroomStreamEvent,
    );
    const reasoning = events.filter((e) => e.event.type === 'reasoning');
    expect(reasoning).toHaveLength(1);
    expect(reasoning[0].event).toMatchObject({ type: 'reasoning', reasoningId: 'r-1', content: 'thinking...' });
  });

  it('returns finalContent and messageId', async () => {
    const sess = createMockSession();
    autoIdle(sess);

    const result = await streamAgentTurn(makeStreamOpts(sess));

    expect(result.finalContent).toBe('Hello from agent');
    expect(result.messageId).toBe('uuid-1');
  });

  it('does NOT emit events when abortSignal is aborted', async () => {
    const sess = createMockSession();
    const ctx = createContext(sessions);
    const ac = new AbortController();
    ac.abort();

    sess.send.mockImplementation(async () => {
      setTimeout(() => {
        sess._emit('assistant.message_delta', {
          data: { messageId: 'sdk-1', deltaContent: 'should not appear' },
        });
        sess._emit('session.idle', {});
      }, 0);
    });

    await streamAgentTurn(makeStreamOpts(sess, { context: ctx, abortSignal: ac.signal }));

    expect(ctx.emitEvent).not.toHaveBeenCalled();
  });

  it('resolves on session.idle', async () => {
    const sess = createMockSession();
    sess.send.mockImplementation(async () => {
      setTimeout(() => sess._emit('session.idle', {}), 0);
    });

    const result = await streamAgentTurn(makeStreamOpts(sess));
    expect(result.finalContent).toBe('');
  });

  it('rejects on session.error', async () => {
    const sess = createMockSession();
    sess.send.mockImplementation(async () => {
      setTimeout(() => {
        sess._emit('session.error', { data: { message: 'boom' } });
      }, 0);
    });

    await expect(streamAgentTurn(makeStreamOpts(sess))).rejects.toThrow('boom');
  });

  it('pushes unsub functions into the unsubs array', async () => {
    const sess = createMockSession();
    const unsubs: (() => void)[] = [];
    autoIdle(sess);

    await streamAgentTurn(makeStreamOpts(sess, { unsubs }));

    // 7 event listeners + 2 (idle + error) = 9 unsubs
    expect(unsubs.length).toBeGreaterThanOrEqual(9);
    for (const u of unsubs) expect(typeof u).toBe('function');
  });

  it('send timeout: rejects with "Session not found" if session.send hangs for 30s', async () => {
    vi.useFakeTimers();
    const sess = createMockSession();
    // send never resolves
    sess.send.mockReturnValue(new Promise(() => {}));

    // Suppress the PromiseRejectionHandledWarning that vitest's fake timer
    // implementation triggers: the timer fires reject() in a setImmediate
    // macrotask before the Promise.race microtask handler can catch it.
    const swallow = () => {};
    process.on('unhandledRejection', swallow);

    const promise = streamAgentTurn(makeStreamOpts(sess));

    await vi.advanceTimersByTimeAsync(30_000);

    await expect(promise).rejects.toThrow('Session not found');

    // Drain the orphaned turnDone 300 000 ms timeout so it doesn't leak
    await vi.runAllTimersAsync();
    process.removeListener('unhandledRejection', swallow);
  });
});

// ---------------------------------------------------------------------------
// sendToAgentWithRetry
// ---------------------------------------------------------------------------

describe('sendToAgentWithRetry', () => {
  let sessions: Map<string, MockSession>;

  beforeEach(() => {
    vi.clearAllMocks();
    resetUUIDs();
    sessions = new Map();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeSendOpts(
    ctx: OrchestrationContext,
    overrides?: Partial<SendToAgentOptions>,
  ): SendToAgentOptions {
    return {
      mind,
      prompt: 'Hello',
      roundId: 'round-1',
      context: ctx,
      abortSignal: new AbortController().signal,
      unsubs: [],
      orchestrationMode: 'concurrent',
      ...overrides,
    };
  }

  it('happy path: creates session, streams, persists message, emits done', async () => {
    const sess = createMockSession();
    sessions.set('dude', sess);
    autoIdle(sess);
    const ctx = createContext(sessions);

    const result = await sendToAgentWithRetry(makeSendOpts(ctx));

    expect(ctx.getOrCreateSession).toHaveBeenCalledWith('dude');
    expect(sess.send).toHaveBeenCalledTimes(1);
    expect(ctx.persistMessage).toHaveBeenCalledTimes(1);
    expect(result.message).not.toBeNull();
    expect(result.message!.role).toBe('assistant');

    const events = (ctx.emitEvent as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0] as ChatroomStreamEvent,
    );
    expect(events.some((e) => e.event.type === 'done')).toBe(true);
  });

  it('returns rawContent (before transform) and message (after transform)', async () => {
    const sess = createMockSession();
    sessions.set('dude', sess);
    autoIdle(sess);
    const ctx = createContext(sessions);

    const result = await sendToAgentWithRetry(
      makeSendOpts(ctx, {
        transformContent: (raw) => raw.toUpperCase(),
      }),
    );

    expect(result.rawContent).toBe('Hello from agent');
    expect(result.message!.blocks[0]).toMatchObject({ type: 'text', content: 'HELLO FROM AGENT' });
  });

  it('applies transformContent to display content', async () => {
    const sess = createMockSession();
    sessions.set('dude', sess);
    autoIdle(sess);
    const ctx = createContext(sessions);

    const result = await sendToAgentWithRetry(
      makeSendOpts(ctx, { transformContent: () => 'transformed' }),
    );

    expect(result.message!.blocks[0]).toMatchObject({ type: 'text', content: 'transformed' });
  });

  it('returns null message when finalContent is empty', async () => {
    const sess = createMockSession();
    sessions.set('dude', sess);
    // Idle with no content
    sess.send.mockImplementation(async () => {
      setTimeout(() => sess._emit('session.idle', {}), 0);
    });
    const ctx = createContext(sessions);

    const result = await sendToAgentWithRetry(makeSendOpts(ctx));

    expect(result.message).toBeNull();
    expect(result.rawContent).toBe('');
  });

  it('returns null message when aborted', async () => {
    const sess = createMockSession();
    sessions.set('dude', sess);
    const ac = new AbortController();
    ac.abort();
    const ctx = createContext(sessions);

    sess.send.mockImplementation(async () => {
      setTimeout(() => {
        sess._emit('assistant.message', {
          data: { messageId: 'sdk-1', content: 'content' },
        });
        sess._emit('session.idle', {});
      }, 0);
    });

    const result = await sendToAgentWithRetry(makeSendOpts(ctx, { abortSignal: ac.signal }));

    expect(result.message).toBeNull();
  });

  it('retries once on stale session error (evicts + creates fresh session)', async () => {
    const staleSess = createMockSession();
    sessions.set('dude', staleSess);
    staleSess.send.mockImplementation(async () => {
      setTimeout(() => {
        staleSess._emit('session.error', {
          data: { message: 'Session not found: abc-123' },
        });
      }, 0);
    });

    const ctx = createContext(sessions);

    // After eviction, getOrCreateSession will create a fresh session via the Map
    // We need the fresh session to succeed
    const freshSess = createMockSession();
    autoIdle(freshSess);

    let callCount = 0;
    (ctx.getOrCreateSession as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return staleSess;
      return freshSess;
    });

    const result = await sendToAgentWithRetry(makeSendOpts(ctx));

    expect(ctx.evictSession).toHaveBeenCalledWith('dude');
    expect(ctx.getOrCreateSession).toHaveBeenCalledTimes(2);
    expect(result.message).not.toBeNull();
  });

  it('throws on non-stale errors (does NOT retry)', async () => {
    const sess = createMockSession();
    sessions.set('dude', sess);
    sess.send.mockImplementation(async () => {
      setTimeout(() => {
        sess._emit('session.error', { data: { message: 'Something else broke' } });
      }, 0);
    });
    const ctx = createContext(sessions);

    await expect(sendToAgentWithRetry(makeSendOpts(ctx))).rejects.toThrow('Something else broke');
    expect(ctx.evictSession).not.toHaveBeenCalled();
    expect(ctx.getOrCreateSession).toHaveBeenCalledTimes(1);
  });

  it('cleans up unsubs in finally block', async () => {
    const sess = createMockSession();
    sessions.set('dude', sess);
    autoIdle(sess);
    const ctx = createContext(sessions);
    const unsubs: (() => void)[] = [];

    await sendToAgentWithRetry(makeSendOpts(ctx, { unsubs }));

    // unsubs are called and array cleared in the finally block
    expect(unsubs).toHaveLength(0);
  });

  it("caller's unsubs array receives listeners for mid-turn stop", async () => {
    const sess = createMockSession();
    sessions.set('dude', sess);
    const ctx = createContext(sessions);
    const callerUnsubs: (() => void)[] = [];

    // Send hangs so we can inspect unsubs mid-flight
    let resolveSend: () => void;
    sess.send.mockImplementation(
      () => new Promise<void>((r) => { resolveSend = r; }),
    );

    const promise = sendToAgentWithRetry(makeSendOpts(ctx, { unsubs: callerUnsubs }));

    // Wait for send to be called
    await vi.waitFor(() => expect(sess.send).toHaveBeenCalled());

    // Mid-turn: unsubs should have been populated by streamAgentTurn
    expect(callerUnsubs.length).toBeGreaterThan(0);

    // Now let it finish
    resolveSend!();
    setTimeout(() => sess._emit('session.idle', {}), 0);
    await promise;
  });
});
