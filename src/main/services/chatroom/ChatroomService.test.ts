import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { EventEmitter } from 'events';

// Mock electron app for userData path
vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/mock/userData') },
}));

// Mock node:fs
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  mkdirSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

// Mock node:crypto for UUID generation
const mockRandomUUID = vi.fn(() => 'test-uuid');
vi.mock('node:crypto', () => ({
  randomUUID: (...args: any[]) => mockRandomUUID(...args),
}));

import * as fs from 'node:fs';
import { ChatroomService, type ChatroomSessionFactory } from './ChatroomService';
import type { ChatroomMessage, ChatroomStreamEvent } from '../../../shared/chatroom-types';
import type { MindContext } from '../../../shared/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockSession() {
  const listeners = new Map<string, ((...args: any[]) => void)[]>();
  return {
    send: vi.fn(async () => {}),
    abort: vi.fn(async () => {}),
    destroy: vi.fn(async () => {}),
    on: vi.fn((event: string, cb: (...args: any[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(cb);
      const unsub = vi.fn(() => {
        const cbs = listeners.get(event);
        if (cbs) {
          const idx = cbs.indexOf(cb);
          if (idx >= 0) cbs.splice(idx, 1);
        }
      });
      return unsub;
    }),
    _emit(event: string, data: any) {
      for (const cb of listeners.get(event) ?? []) cb(data);
    },
    _listeners: listeners,
  };
}

function makeMind(id: string, name: string, status: 'ready' | 'loading' = 'ready'): MindContext {
  return {
    mindId: id,
    mindPath: `/minds/${id}`,
    identity: { name, systemMessage: `I am ${name}` },
    status,
  };
}

function createFactory(minds: MindContext[], sessions: Map<string, ReturnType<typeof createMockSession>>) {
  const emitter = new EventEmitter();
  const factory: ChatroomSessionFactory & EventEmitter = Object.assign(emitter, {
    createChatroomSession: vi.fn(async (mindId: string) => {
      if (!sessions.has(mindId)) sessions.set(mindId, createMockSession());
      return sessions.get(mindId)!;
    }),
    listMinds: vi.fn(() => minds),
  });
  return factory;
}

/** Simulate a session completing immediately after send */
function autoIdle(session: ReturnType<typeof createMockSession>) {
  session.send.mockImplementation(async () => {
    // Emit a text chunk then idle
    setTimeout(() => {
      session._emit('assistant.message', {
        data: { messageId: 'sdk-msg-1', content: 'Hello from agent' },
      });
      session._emit('session.idle', {});
    }, 0);
  });
}

/** Simulate a session that never completes (hangs) */
function neverIdle(session: ReturnType<typeof createMockSession>) {
  session.send.mockImplementation(async () => {
    // emit a chunk but never idle
    setTimeout(() => {
      session._emit('assistant.message_delta', {
        data: { messageId: 'sdk-msg-1', deltaContent: 'partial...' },
      });
    }, 0);
  });
}

function setupCleanFs() {
  vi.mocked(fs.existsSync).mockReturnValue(false);
  vi.mocked(fs.readFileSync).mockImplementation(() => {
    throw new Error('ENOENT');
  });
}

// Track UUIDs for round/message IDs
let uuidCounter = 0;
function resetUUIDs() {
  uuidCounter = 0;
  mockRandomUUID.mockImplementation(() => `uuid-${++uuidCounter}`);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChatroomService', () => {
  let sessions: Map<string, ReturnType<typeof createMockSession>>;
  let minds: MindContext[];
  let factory: ChatroomSessionFactory & EventEmitter;
  let svc: ChatroomService;

  beforeEach(() => {
    vi.clearAllMocks();
    setupCleanFs();
    resetUUIDs();

    sessions = new Map();
    minds = [makeMind('dude', 'The Dude'), makeMind('jarvis', 'Jarvis')];
    factory = createFactory(minds, sessions);
    svc = new ChatroomService(factory);
  });

  // 1. Broadcast fan-out
  describe('broadcast fan-out', () => {
    it('broadcasts to all ready minds in parallel', async () => {
      const dudeSess = createMockSession();
      const jarvisSess = createMockSession();
      sessions.set('dude', dudeSess);
      sessions.set('jarvis', jarvisSess);
      autoIdle(dudeSess);
      autoIdle(jarvisSess);

      await svc.broadcast('Hello everyone');

      expect(factory.createChatroomSession).toHaveBeenCalledWith('dude');
      expect(factory.createChatroomSession).toHaveBeenCalledWith('jarvis');
      expect(dudeSess.send).toHaveBeenCalledTimes(1);
      expect(jarvisSess.send).toHaveBeenCalledTimes(1);
    });
  });

  // 2. Session isolation
  describe('session isolation', () => {
    it('uses createChatroomSession, not primary sessions', async () => {
      const sess = createMockSession();
      sessions.set('dude', sess);
      autoIdle(sess);
      minds.length = 0;
      minds.push(makeMind('dude', 'The Dude'));

      await svc.broadcast('test');

      expect(factory.createChatroomSession).toHaveBeenCalledWith('dude');
    });
  });

  // 3. Session caching
  describe('session caching', () => {
    it('reuses sessions across rounds', async () => {
      const sess = createMockSession();
      sessions.set('dude', sess);
      autoIdle(sess);
      minds.length = 0;
      minds.push(makeMind('dude', 'The Dude'));

      await svc.broadcast('round 1');
      await svc.broadcast('round 2');

      // createChatroomSession called only once — cached after first
      expect(factory.createChatroomSession).toHaveBeenCalledTimes(1);
      expect(sess.send).toHaveBeenCalledTimes(2);
    });
  });

  // 4. Round context injection
  describe('round context injection', () => {
    it('includes XML history from previous rounds in prompt', async () => {
      const sess = createMockSession();
      sessions.set('dude', sess);
      minds.length = 0;
      minds.push(makeMind('dude', 'The Dude'));

      // First round: auto-idle with response
      autoIdle(sess);
      await svc.broadcast('First question');

      // Second round: capture prompt
      autoIdle(sess);
      await svc.broadcast('Second question');

      const secondPrompt = sess.send.mock.calls[1][0].prompt as string;
      expect(secondPrompt).toContain('<chatroom-history');
      expect(secondPrompt).toContain('participants="The Dude"');
      expect(secondPrompt).toContain('<message sender="You">First question</message>');
      expect(secondPrompt).toContain('<message sender="The Dude">Hello from agent</message>');
      expect(secondPrompt).toContain('<message sender="You">Second question</message>');
    });
  });

  // 5. XML escaping
  describe('XML escaping', () => {
    it('escapes special characters in messages', async () => {
      const sess = createMockSession();
      sessions.set('dude', sess);
      minds.length = 0;
      minds.push(makeMind('dude', 'The Dude'));

      // First round with special chars
      sess.send.mockImplementation(async () => {
        setTimeout(() => {
          sess._emit('assistant.message', {
            data: { messageId: 'sdk-1', content: 'Use <div> & "quotes"' },
          });
          sess._emit('session.idle', {});
        }, 0);
      });
      await svc.broadcast('What about <script> & stuff?');

      // Second round: check prompt has escaped content
      autoIdle(sess);
      await svc.broadcast('Follow up');

      const prompt = sess.send.mock.calls[1][0].prompt as string;
      expect(prompt).toContain('&lt;script&gt; &amp; stuff?');
      expect(prompt).toContain('&lt;div&gt; &amp; &quot;quotes&quot;');
    });
  });

  // 6. Context window — only last 2 rounds
  describe('context window', () => {
    it('only includes last 2 rounds in history', async () => {
      const sess = createMockSession();
      sessions.set('dude', sess);
      minds.length = 0;
      minds.push(makeMind('dude', 'The Dude'));
      autoIdle(sess);

      await svc.broadcast('Round 1');
      await svc.broadcast('Round 2');
      await svc.broadcast('Round 3');
      await svc.broadcast('Round 4');

      const lastPrompt = sess.send.mock.calls[3][0].prompt as string;
      // Should NOT contain Round 1 (too old)
      expect(lastPrompt).not.toContain('Round 1');
      // Should contain Rounds 2 and 3
      expect(lastPrompt).toContain('Round 2');
      expect(lastPrompt).toContain('Round 3');
      expect(lastPrompt).toContain('Round 4');
    });
  });

  // 7. Incremental persistence
  describe('incremental persistence', () => {
    it('saves user message immediately, agent replies on completion', async () => {
      const sess = createMockSession();
      sessions.set('dude', sess);
      minds.length = 0;
      minds.push(makeMind('dude', 'The Dude'));

      const writeTimestamps: string[] = [];
      vi.mocked(fs.writeFileSync).mockImplementation((_p, data) => {
        writeTimestamps.push(data as string);
      });
      vi.mocked(fs.renameSync).mockImplementation(() => {});

      autoIdle(sess);
      await svc.broadcast('Hello');

      // Should have at least 2 writes: one for user message, one after agent reply
      expect(writeTimestamps.length).toBeGreaterThanOrEqual(2);

      // First write should contain user message but not agent reply
      const firstWrite = JSON.parse(writeTimestamps[0]);
      expect(firstWrite.messages.some((m: any) => m.role === 'user')).toBe(true);
      expect(firstWrite.messages.some((m: any) => m.role === 'assistant')).toBe(false);

      // Last write should contain both
      const lastWrite = JSON.parse(writeTimestamps[writeTimestamps.length - 1]);
      expect(lastWrite.messages.some((m: any) => m.role === 'user')).toBe(true);
      expect(lastWrite.messages.some((m: any) => m.role === 'assistant')).toBe(true);
    });
  });

  // 8. Persistence cap
  describe('persistence cap', () => {
    it('trims to 500 messages on save', async () => {
      // Pre-load 499 messages
      const existingMessages: ChatroomMessage[] = [];
      for (let i = 0; i < 499; i++) {
        existingMessages.push({
          id: `old-${i}`,
          role: 'user',
          blocks: [{ type: 'text', content: `msg ${i}` }],
          timestamp: i,
          sender: { mindId: 'user', name: 'You' },
          roundId: `round-${i}`,
        });
      }
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({ version: 1, messages: existingMessages }),
      );

      // Only one mind so we don't have dangling sessions
      minds.length = 0;
      minds.push(makeMind('dude', 'The Dude'));

      const sess = createMockSession();
      sessions.set('dude', sess);
      autoIdle(sess);

      svc = new ChatroomService(factory);

      await svc.broadcast('New message');

      // Check written data — should be capped at 500
      const writeCall = vi.mocked(fs.writeFileSync).mock.calls;
      const lastWrite = writeCall[writeCall.length - 1];
      const written = JSON.parse(lastWrite[1] as string);
      expect(written.messages.length).toBeLessThanOrEqual(500);
    });
  });

  // 9. Persistence loading
  describe('persistence loading', () => {
    it('loads existing transcript on construction', async () => {
      const existing: ChatroomMessage[] = [
        {
          id: 'prev-1',
          role: 'user',
          blocks: [{ type: 'text', content: 'Old message' }],
          timestamp: 1000,
          sender: { mindId: 'user', name: 'You' },
          roundId: 'old-round',
        },
      ];
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({ version: 1, messages: existing }),
      );

      const loaded = new ChatroomService(factory);
      const history = loaded.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].id).toBe('prev-1');
    });
  });

  // 10. Mid-round send
  describe('mid-round send', () => {
    it('new broadcast cancels previous round in-flight agents', async () => {
      const sess = createMockSession();
      sessions.set('dude', sess);
      minds.length = 0;
      minds.push(makeMind('dude', 'The Dude'));

      // First round never completes
      neverIdle(sess);
      const firstBroadcast = svc.broadcast('First');

      // Wait for send to fire
      await vi.waitFor(() => expect(sess.send).toHaveBeenCalledTimes(1));

      // Second broadcast should cancel first
      autoIdle(sess);
      await svc.broadcast('Second');

      expect(sess.abort).toHaveBeenCalled();
    });
  });

  // 11. stopAll
  describe('stopAll', () => {
    it('cancels all in-flight agents', async () => {
      const dudeSess = createMockSession();
      const jarvisSess = createMockSession();
      sessions.set('dude', dudeSess);
      sessions.set('jarvis', jarvisSess);
      neverIdle(dudeSess);
      neverIdle(jarvisSess);

      const broadcastPromise = svc.broadcast('Hello');

      // Wait for sends to fire
      await vi.waitFor(() => {
        expect(dudeSess.send).toHaveBeenCalled();
        expect(jarvisSess.send).toHaveBeenCalled();
      });

      svc.stopAll();

      expect(dudeSess.abort).toHaveBeenCalled();
      expect(jarvisSess.abort).toHaveBeenCalled();

      // Broadcast should resolve (not hang)
      await broadcastPromise;
    });
  });

  // 12. Participant snapshot
  describe('participant snapshot', () => {
    it('uses minds at broadcast time, not later additions', async () => {
      const dudeSess = createMockSession();
      sessions.set('dude', dudeSess);
      autoIdle(dudeSess);

      // Start with only dude
      minds.length = 0;
      minds.push(makeMind('dude', 'The Dude'));

      const broadcastPromise = svc.broadcast('Hello');

      // Add jarvis mid-broadcast
      minds.push(makeMind('jarvis', 'Jarvis'));

      await broadcastPromise;

      // Only dude should have been contacted
      expect(factory.createChatroomSession).toHaveBeenCalledTimes(1);
      expect(factory.createChatroomSession).toHaveBeenCalledWith('dude');
    });
  });

  // 13. Mind unload
  describe('mind unload', () => {
    it('cancels in-flight and destroys cached session on mind:unloaded', async () => {
      const sess = createMockSession();
      sessions.set('dude', sess);
      minds.length = 0;
      minds.push(makeMind('dude', 'The Dude'));

      // Start a broadcast that doesn't complete
      neverIdle(sess);
      const broadcastPromise = svc.broadcast('Hello');

      await vi.waitFor(() => expect(sess.send).toHaveBeenCalled());

      // Simulate mind unload event
      (factory as EventEmitter).emit('mind:unloaded', 'dude');

      expect(sess.abort).toHaveBeenCalled();
      expect(sess.destroy).toHaveBeenCalled();

      // Broadcast should resolve
      await broadcastPromise;
    });
  });

  // 14. Per-agent error isolation
  describe('per-agent error isolation', () => {
    it('one agent failing does not affect others', async () => {
      const dudeSess = createMockSession();
      const jarvisSess = createMockSession();
      sessions.set('dude', dudeSess);
      sessions.set('jarvis', jarvisSess);

      // Dude errors out
      dudeSess.send.mockImplementation(async () => {
        setTimeout(() => {
          dudeSess._emit('session.error', { data: { message: 'dude broke' } });
        }, 0);
      });

      // Jarvis succeeds
      autoIdle(jarvisSess);

      await svc.broadcast('Hello');

      // Jarvis should have completed fine
      expect(jarvisSess.send).toHaveBeenCalled();

      // History should still have the user message + jarvis reply
      const history = svc.getHistory();
      expect(history.some((m) => m.sender.mindId === 'jarvis')).toBe(true);
    });
  });

  // 15. 0 agents
  describe('0 agents', () => {
    it('broadcast with no ready minds saves user message only', async () => {
      minds.length = 0;

      await svc.broadcast('Hello nobody');

      const history = svc.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].role).toBe('user');
      expect(history[0].blocks[0]).toEqual({ type: 'text', content: 'Hello nobody' });
    });
  });

  // 16. clearHistory
  describe('clearHistory', () => {
    it('clears messages and destroys sessions', async () => {
      const sess = createMockSession();
      sessions.set('dude', sess);
      minds.length = 0;
      minds.push(makeMind('dude', 'The Dude'));
      autoIdle(sess);

      await svc.broadcast('Hello');
      expect(svc.getHistory().length).toBeGreaterThan(0);

      await svc.clearHistory();

      expect(svc.getHistory()).toHaveLength(0);
      expect(sess.destroy).toHaveBeenCalled();
    });
  });

  // 17. Event emission
  describe('event emission', () => {
    it('emits ChatroomStreamEvents with correct shape', async () => {
      const sess = createMockSession();
      sessions.set('dude', sess);
      minds.length = 0;
      minds.push(makeMind('dude', 'The Dude'));

      const events: ChatroomStreamEvent[] = [];
      svc.on('chatroom:event', (event: ChatroomStreamEvent) => events.push(event));

      sess.send.mockImplementation(async () => {
        setTimeout(() => {
          sess._emit('assistant.message_delta', {
            data: { messageId: 'sdk-1', deltaContent: 'Hello' },
          });
          sess._emit('session.idle', {});
        }, 0);
      });

      await svc.broadcast('Hi');

      expect(events.length).toBeGreaterThan(0);
      const chunkEvent = events.find((e) => e.event.type === 'chunk');
      expect(chunkEvent).toBeDefined();
      expect(chunkEvent!.mindId).toBe('dude');
      expect(chunkEvent!.mindName).toBe('The Dude');
      expect(chunkEvent!.roundId).toBeTruthy();
      expect(chunkEvent!.messageId).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // Stale session retry
  // -------------------------------------------------------------------------

  describe('stale session retry', () => {
    it('evicts cache and retries with fresh session on stale error', async () => {
      minds.length = 0;
      minds.push(makeMind('dude', 'The Dude'));

      const staleSess = createMockSession();
      const freshSess = createMockSession();

      // First call returns stale session, second returns fresh
      (factory.createChatroomSession as Mock)
        .mockResolvedValueOnce(staleSess)
        .mockResolvedValueOnce(freshSess);

      // Stale session: send rejects with stale error
      staleSess.send.mockRejectedValueOnce(new Error('Session not found: abc-123'));

      // Fresh session: auto-idle
      autoIdle(freshSess);

      await svc.broadcast('Hello');

      // Factory called twice: once initially, once after cache eviction
      expect(factory.createChatroomSession).toHaveBeenCalledTimes(2);
      expect(factory.createChatroomSession).toHaveBeenCalledWith('dude');
      // Fresh session received the prompt
      expect(freshSess.send).toHaveBeenCalled();
    });

    it('does not loop — second stale failure propagates without third attempt', async () => {
      minds.length = 0;
      minds.push(makeMind('dude', 'The Dude'));

      const staleSess1 = createMockSession();
      const staleSess2 = createMockSession();

      (factory.createChatroomSession as Mock)
        .mockResolvedValueOnce(staleSess1)
        .mockResolvedValueOnce(staleSess2);

      staleSess1.send.mockRejectedValueOnce(new Error('Session not found: abc'));
      staleSess2.send.mockRejectedValueOnce(new Error('Session not found: def'));

      // broadcast catches per-agent errors — should not throw
      await svc.broadcast('Hello');

      // Only two factory calls (initial + one retry), not three
      expect(factory.createChatroomSession).toHaveBeenCalledTimes(2);
    });

    it('does not retry on non-stale errors', async () => {
      minds.length = 0;
      minds.push(makeMind('dude', 'The Dude'));

      const sess = createMockSession();
      (factory.createChatroomSession as Mock).mockResolvedValueOnce(sess);

      sess.send.mockRejectedValueOnce(new Error('Network error'));

      const events: ChatroomStreamEvent[] = [];
      svc.on('chatroom:event', (e: ChatroomStreamEvent) => events.push(e));

      await svc.broadcast('Hello');

      // Only one factory call — no retry
      expect(factory.createChatroomSession).toHaveBeenCalledTimes(1);
      // Error event emitted (not swallowed)
      expect(events.some((e) => e.event.type === 'error')).toBe(true);
    });
  });

  // Edge: filters non-ready minds
  describe('filters non-ready minds', () => {
    it('skips minds that are not status ready', async () => {
      minds.length = 0;
      minds.push(makeMind('dude', 'The Dude', 'ready'));
      minds.push(makeMind('loading-mind', 'Loading', 'loading'));

      const sess = createMockSession();
      sessions.set('dude', sess);
      autoIdle(sess);

      await svc.broadcast('Hello');

      expect(factory.createChatroomSession).toHaveBeenCalledTimes(1);
      expect(factory.createChatroomSession).toHaveBeenCalledWith('dude');
    });
  });
});
