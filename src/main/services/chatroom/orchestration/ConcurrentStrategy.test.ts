import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock node:crypto for UUID generation
const mockRandomUUID = vi.fn(() => 'test-uuid');
vi.mock('node:crypto', () => ({
  randomUUID: (...args: unknown[]) => mockRandomUUID(...args),
}));

import { ConcurrentStrategy } from './ConcurrentStrategy';
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

function autoIdle(session: ReturnType<typeof createMockSession>) {
  session.send.mockImplementation(async () => {
    setTimeout(() => {
      session._emit('assistant.message', {
        data: { messageId: 'sdk-msg-1', content: 'Hello from agent' },
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
    buildBasePrompt: vi.fn((_msg: string, _parts: MindContext[]) => 'test prompt'),
    emitEvent: vi.fn((event: ChatroomStreamEvent) => events.push(event)),
    persistMessage: vi.fn((msg: ChatroomMessage) => messages.push(msg)),
    getHistory: vi.fn(() => []),
    orchestrationMode: 'concurrent',
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

describe('ConcurrentStrategy', () => {
  let sessions: Map<string, ReturnType<typeof createMockSession>>;

  beforeEach(() => {
    vi.clearAllMocks();
    resetUUIDs();
    sessions = new Map();
  });

  it('fans out to all participants in parallel', async () => {
    const dudeSess = createMockSession();
    const jarvisSess = createMockSession();
    sessions.set('dude', dudeSess);
    sessions.set('jarvis', jarvisSess);
    autoIdle(dudeSess);
    autoIdle(jarvisSess);

    const strategy = new ConcurrentStrategy();
    const ctx = createContext(sessions);
    const minds = [makeMind('dude', 'The Dude'), makeMind('jarvis', 'Jarvis')];

    await strategy.execute('Hello everyone', minds, 'round-1', ctx);

    expect(ctx.getOrCreateSession).toHaveBeenCalledWith('dude');
    expect(ctx.getOrCreateSession).toHaveBeenCalledWith('jarvis');
    expect(dudeSess.send).toHaveBeenCalledTimes(1);
    expect(jarvisSess.send).toHaveBeenCalledTimes(1);
  });

  it('does nothing with 0 participants', async () => {
    const strategy = new ConcurrentStrategy();
    const ctx = createContext(sessions);

    await strategy.execute('Hello', [], 'round-1', ctx);

    expect(ctx.getOrCreateSession).not.toHaveBeenCalled();
  });

  it('persists agent messages on completion', async () => {
    const sess = createMockSession();
    sessions.set('dude', sess);
    autoIdle(sess);

    const strategy = new ConcurrentStrategy();
    const ctx = createContext(sessions);

    await strategy.execute('Hello', [makeMind('dude', 'The Dude')], 'round-1', ctx);

    expect(ctx.persistMessage).toHaveBeenCalledTimes(1);
    const msg = (ctx.persistMessage as ReturnType<typeof vi.fn>).mock.calls[0][0] as ChatroomMessage;
    expect(msg.role).toBe('assistant');
    expect(msg.sender.mindId).toBe('dude');
    expect(msg.orchestrationMode).toBe('concurrent');
  });

  it('emits done event for each agent', async () => {
    const sess = createMockSession();
    sessions.set('dude', sess);
    autoIdle(sess);

    const strategy = new ConcurrentStrategy();
    const ctx = createContext(sessions);

    await strategy.execute('Hello', [makeMind('dude', 'The Dude')], 'round-1', ctx);

    const events = (ctx.emitEvent as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0] as ChatroomStreamEvent,
    );
    expect(events.some((e) => e.event.type === 'done')).toBe(true);
  });

  it('one agent failing does not affect others', async () => {
    const dudeSess = createMockSession();
    const jarvisSess = createMockSession();
    sessions.set('dude', dudeSess);
    sessions.set('jarvis', jarvisSess);

    dudeSess.send.mockImplementation(async () => {
      setTimeout(() => {
        dudeSess._emit('session.error', { data: { message: 'dude broke' } });
      }, 0);
    });
    autoIdle(jarvisSess);

    const strategy = new ConcurrentStrategy();
    const ctx = createContext(sessions);
    const minds = [makeMind('dude', 'The Dude'), makeMind('jarvis', 'Jarvis')];

    await strategy.execute('Hello', minds, 'round-1', ctx);

    expect(jarvisSess.send).toHaveBeenCalled();
    expect(ctx.persistMessage).toHaveBeenCalledTimes(1);
  });

  it('stop cancels in-flight agents', async () => {
    const sess = createMockSession();
    sessions.set('dude', sess);
    // Never idle — send hangs
    sess.send.mockImplementation(async () => {
      setTimeout(() => {
        sess._emit('assistant.message_delta', {
          data: { messageId: 'sdk-1', deltaContent: 'partial...' },
        });
      }, 0);
    });

    const strategy = new ConcurrentStrategy();
    const ctx = createContext(sessions);

    const promise = strategy.execute('Hello', [makeMind('dude', 'The Dude')], 'round-1', ctx);

    await vi.waitFor(() => expect(sess.send).toHaveBeenCalled());
    strategy.stop();

    await promise; // Should resolve without hanging
  });

  it('mode property is concurrent', () => {
    const strategy = new ConcurrentStrategy();
    expect(strategy.mode).toBe('concurrent');
  });
});
