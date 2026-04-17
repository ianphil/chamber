import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock node:crypto for UUID generation
const mockRandomUUID = vi.fn(() => 'test-uuid');
vi.mock('node:crypto', () => ({
  randomUUID: (...args: unknown[]) => mockRandomUUID(...args),
}));

import { SequentialStrategy } from './SequentialStrategy';
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

function autoIdleWith(session: ReturnType<typeof createMockSession>, content: string) {
  session.send.mockImplementation(async () => {
    setTimeout(() => {
      session._emit('assistant.message', {
        data: { messageId: 'sdk-msg-1', content },
      });
      session._emit('session.idle', {});
    }, 0);
  });
}

function makeMind(id: string, name: string): MindContext {
  return {
    mindId: id,
    mindPath: `/minds/${id}`,
    identity: { name, systemMessage: `I am ${name}` },
    status: 'ready',
  };
}

function createContext(
  sessions: Map<string, ReturnType<typeof createMockSession>>,
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
    buildBasePrompt: vi.fn((_msg: string, _parts: MindContext[]) => '<message sender="You">test</message>'),
    emitEvent: vi.fn((event: ChatroomStreamEvent) => events.push(event)),
    persistMessage: vi.fn((msg: ChatroomMessage) => messages.push(msg)),
    getHistory: vi.fn(() => []),
    orchestrationMode: 'sequential',
    ...overrides,
  };
}

let uuidCounter = 0;
function resetUUIDs() {
  uuidCounter = 0;
  mockRandomUUID.mockImplementation(() => `uuid-${++uuidCounter}`);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SequentialStrategy', () => {
  let sessions: Map<string, ReturnType<typeof createMockSession>>;

  beforeEach(() => {
    vi.clearAllMocks();
    resetUUIDs();
    sessions = new Map();
  });

  it('calls agents sequentially, not in parallel', async () => {
    const dudeSess = createMockSession();
    const jarvisSess = createMockSession();
    sessions.set('dude', dudeSess);
    sessions.set('jarvis', jarvisSess);

    const callOrder: string[] = [];
    dudeSess.send.mockImplementation(async () => {
      callOrder.push('dude');
      setTimeout(() => {
        dudeSess._emit('assistant.message', {
          data: { messageId: 'sdk-1', content: 'Dude response' },
        });
        dudeSess._emit('session.idle', {});
      }, 0);
    });
    jarvisSess.send.mockImplementation(async () => {
      callOrder.push('jarvis');
      setTimeout(() => {
        jarvisSess._emit('assistant.message', {
          data: { messageId: 'sdk-2', content: 'Jarvis response' },
        });
        jarvisSess._emit('session.idle', {});
      }, 0);
    });

    const strategy = new SequentialStrategy();
    const ctx = createContext(sessions);
    const minds = [makeMind('dude', 'The Dude'), makeMind('jarvis', 'Jarvis')];

    await strategy.execute('Hello', minds, 'round-1', ctx);

    expect(callOrder).toEqual(['dude', 'jarvis']);
    expect(dudeSess.send).toHaveBeenCalledTimes(1);
    expect(jarvisSess.send).toHaveBeenCalledTimes(1);
  });

  it("agent B's prompt contains agent A's response from same round", async () => {
    const dudeSess = createMockSession();
    const jarvisSess = createMockSession();
    sessions.set('dude', dudeSess);
    sessions.set('jarvis', jarvisSess);

    autoIdleWith(dudeSess, 'Dude says hello');

    // Capture Jarvis prompt
    let jarvisPrompt = '';
    jarvisSess.send.mockImplementation(async (opts: { prompt: string }) => {
      jarvisPrompt = opts.prompt;
      setTimeout(() => {
        jarvisSess._emit('assistant.message', {
          data: { messageId: 'sdk-2', content: 'Jarvis responds' },
        });
        jarvisSess._emit('session.idle', {});
      }, 0);
    });

    const strategy = new SequentialStrategy();
    const ctx = createContext(sessions);
    const minds = [makeMind('dude', 'The Dude'), makeMind('jarvis', 'Jarvis')];

    await strategy.execute('Question?', minds, 'round-1', ctx);

    expect(jarvisPrompt).toContain('<sequential-round>');
    expect(jarvisPrompt).toContain('Dude says hello');
    expect(jarvisPrompt).toContain('The Dude');
  });

  it('agent failure does not prevent subsequent agents', async () => {
    const dudeSess = createMockSession();
    const jarvisSess = createMockSession();
    sessions.set('dude', dudeSess);
    sessions.set('jarvis', jarvisSess);

    dudeSess.send.mockImplementation(async () => {
      setTimeout(() => {
        dudeSess._emit('session.error', { data: { message: 'dude broke' } });
      }, 0);
    });
    autoIdleWith(jarvisSess, 'Jarvis is fine');

    const strategy = new SequentialStrategy();
    const ctx = createContext(sessions);
    const minds = [makeMind('dude', 'The Dude'), makeMind('jarvis', 'Jarvis')];

    await strategy.execute('Hello', minds, 'round-1', ctx);

    expect(jarvisSess.send).toHaveBeenCalled();
    expect(ctx.persistMessage).toHaveBeenCalled();
  });

  it('stop cancels current in-flight agent', async () => {
    const sess = createMockSession();
    sessions.set('dude', sess);
    sess.send.mockImplementation(async () => {
      setTimeout(() => {
        sess._emit('assistant.message_delta', {
          data: { messageId: 'sdk-1', deltaContent: 'partial...' },
        });
      }, 0);
    });

    const strategy = new SequentialStrategy();
    const ctx = createContext(sessions);

    const promise = strategy.execute('Hello', [makeMind('dude', 'The Dude')], 'round-1', ctx);

    await vi.waitFor(() => expect(sess.send).toHaveBeenCalled());
    strategy.stop();

    await promise;
  });

  it('emits orchestration:turn-start for each agent', async () => {
    const dudeSess = createMockSession();
    const jarvisSess = createMockSession();
    sessions.set('dude', dudeSess);
    sessions.set('jarvis', jarvisSess);
    autoIdleWith(dudeSess, 'hi');
    autoIdleWith(jarvisSess, 'hi');

    const strategy = new SequentialStrategy();
    const ctx = createContext(sessions);
    const minds = [makeMind('dude', 'The Dude'), makeMind('jarvis', 'Jarvis')];

    await strategy.execute('Hello', minds, 'round-1', ctx);

    const events = (ctx.emitEvent as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0] as ChatroomStreamEvent,
    );
    const turnStarts = events.filter((e) => e.event.type === 'orchestration:turn-start');
    expect(turnStarts).toHaveLength(2);
    expect(turnStarts[0].mindId).toBe('dude');
    expect(turnStarts[1].mindId).toBe('jarvis');
  });

  it('does nothing with 0 participants', async () => {
    const strategy = new SequentialStrategy();
    const ctx = createContext(sessions);

    await strategy.execute('Hello', [], 'round-1', ctx);

    expect(ctx.getOrCreateSession).not.toHaveBeenCalled();
  });

  it('persists messages with sequential orchestrationMode', async () => {
    const sess = createMockSession();
    sessions.set('dude', sess);
    autoIdleWith(sess, 'reply');

    const strategy = new SequentialStrategy();
    const ctx = createContext(sessions);

    await strategy.execute('Hello', [makeMind('dude', 'The Dude')], 'round-1', ctx);

    const msg = (ctx.persistMessage as ReturnType<typeof vi.fn>).mock.calls[0][0] as ChatroomMessage;
    expect(msg.orchestrationMode).toBe('sequential');
  });

  it('mode property is sequential', () => {
    const strategy = new SequentialStrategy();
    expect(strategy.mode).toBe('sequential');
  });
});
