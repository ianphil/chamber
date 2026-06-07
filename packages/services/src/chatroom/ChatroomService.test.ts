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
  readdirSync: vi.fn(() => []),
  rmSync: vi.fn(),
}));

// Mock node:crypto for UUID generation
const mockRandomUUID = vi.fn(() => 'test-uuid');
vi.mock('node:crypto', () => ({
  randomUUID: () => mockRandomUUID(),
}));

import * as fs from 'node:fs';
import { ChatroomService, type ChatroomSessionFactory } from './ChatroomService';
import type { ChatroomStreamEvent } from '@chamber/shared/chatroom-types';
import type { MindContext } from '@chamber/shared/types';
import type { PermissionHandler } from '@github/copilot-sdk';
import type { AppPaths } from '../ports';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockSession() {
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  return {
    send: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
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
  const factory = Object.assign(emitter, {
    createChatroomSession: vi.fn(async (mindId: string, permissionHandler?: PermissionHandler) => {
      void permissionHandler;
      if (!sessions.has(mindId)) sessions.set(mindId, createMockSession());
      const sess = sessions.get(mindId);
      if (!sess) throw new Error(`expected session for ${mindId}`);
      return sess;
    }),
    listMinds: vi.fn(() => minds),
  }) as unknown as ChatroomSessionFactory & EventEmitter;
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

const mockAppPaths: AppPaths = {
  userData: '/mock/userData',
  logs: '/mock/logs',
  cache: '/mock/cache',
  temp: '/mock/temp',
};

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
    svc = new ChatroomService(factory, mockAppPaths);
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

      expect(factory.createChatroomSession).toHaveBeenCalledWith('dude', expect.any(Function));
      expect(factory.createChatroomSession).toHaveBeenCalledWith('jarvis', expect.any(Function));
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

      expect(factory.createChatroomSession).toHaveBeenCalledWith('dude', expect.any(Function));
    });
  });

  // 3. Session caching
  describe('session caching', () => {
    it('creates fresh sessions between rounds (stopAll clears cache)', async () => {
      const sess = createMockSession();
      sessions.set('dude', sess);
      autoIdle(sess);
      minds.length = 0;
      minds.push(makeMind('dude', 'The Dude'));

      await svc.broadcast('round 1');
      await svc.broadcast('round 2');

      // stopAll between rounds clears cache — session created once per round
      expect(factory.createChatroomSession).toHaveBeenCalledTimes(2);
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

  // 5b. Control JSON stripping
  describe('control JSON stripping in history', () => {
    it('strips orchestration control JSON from history messages', async () => {
      const sess = createMockSession();
      sessions.set('dude', sess);
      minds.length = 0;
      minds.push(makeMind('dude', 'The Dude'));

      // First round: agent responds with control JSON embedded
      sess.send.mockImplementation(async () => {
        setTimeout(() => {
          sess._emit('assistant.message', {
            data: { messageId: 'sdk-1', content: 'I analyzed this. {"action": "done", "reason": "task complete"}' },
          });
          sess._emit('session.idle', {});
        }, 0);
      });
      await svc.broadcast('Analyze this');

      // Second round: check that control JSON was stripped from history
      autoIdle(sess);
      await svc.broadcast('Follow up');

      const prompt = sess.send.mock.calls[1][0].prompt as string;
      expect(prompt).toContain('I analyzed this.');
      expect(prompt).not.toContain('"action"');
      expect(prompt).not.toContain('"done"');
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

  // 7. Incremental persistence + persistence cap + persistence loading
  //
  // The original three describes here asserted internal fs.writeFileSync
  // call patterns against the legacy single-file `chatroom.json` layout.
  // Persistence now lives in ChatroomSessionStore (covered by
  // ChatroomSessionStore.test.ts with real fs in os.tmpdir), and the
  // end-to-end session API is covered by ChatroomService.sessions.test.ts.
  // The fs-mock-driven assertions were dropped to avoid coupling these
  // behavior tests to disk-layout details that are exercised elsewhere.

  // 10. Mid-round send
  describe('mid-round send', () => {
    it('new broadcast cancels previous round in-flight agents', async () => {
      const sess = createMockSession();
      sessions.set('dude', sess);
      minds.length = 0;
      minds.push(makeMind('dude', 'The Dude'));

      // First round never completes
      neverIdle(sess);
      svc.broadcast('First');

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
      expect(factory.createChatroomSession).toHaveBeenCalledWith('dude', expect.any(Function));
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
      expect(sess.disconnect).toHaveBeenCalled();

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
    it('broadcast with no ready minds saves user message and a system message', async () => {
      minds.length = 0;

      await svc.broadcast('Hello nobody');

      const history = svc.getHistory();
      expect(history).toHaveLength(2);
      expect(history[0].role).toBe('user');
      expect(history[0].blocks[0]).toEqual({ type: 'text', content: 'Hello nobody' });
      expect(history[1].role).toBe('assistant');
      expect(history[1].sender.mindId).toBe('system');
      expect(history[1].blocks[0]).toMatchObject({ type: 'text' });
      // Both messages share the same roundId so the renderer groups them.
      expect(history[1].roundId).toBe(history[0].roundId);
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
      expect(sess.disconnect).toHaveBeenCalled();
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
      if (!chunkEvent) throw new Error('expected chunk event');
      expect(chunkEvent.mindId).toBe('dude');
      expect(chunkEvent.mindName).toBe('The Dude');
      expect(chunkEvent.roundId).toBeTruthy();
      expect(chunkEvent.messageId).toBeTruthy();
    });

    it('honors the caller-supplied roundId so renderer and service agree', async () => {
      const sess = createMockSession();
      sessions.set('dude', sess);
      minds.length = 0;
      minds.push(makeMind('dude', 'The Dude'));

      const events: ChatroomStreamEvent[] = [];
      svc.on('chatroom:event', (event: ChatroomStreamEvent) => events.push(event));

      sess.send.mockImplementation(async () => {
        setTimeout(() => {
          sess._emit('assistant.message_delta', {
            data: { messageId: 'sdk-1', deltaContent: 'Hi' },
          });
          sess._emit('session.idle', {});
        }, 0);
      });

      const supplied = 'renderer-round-12345';
      await svc.broadcast('Hi', supplied);

      const persisted = svc.getHistory();
      const userMsg = persisted.find((m) => m.role === 'user');
      expect(userMsg?.roundId).toBe(supplied);

      const chunkEvent = events.find((e) => e.event.type === 'chunk');
      expect(chunkEvent?.roundId).toBe(supplied);
    });

    it('falls back to a generated roundId when caller omits one', async () => {
      const sess = createMockSession();
      sessions.set('dude', sess);
      minds.length = 0;
      minds.push(makeMind('dude', 'The Dude'));
      autoIdle(sess);

      await svc.broadcast('Hi');

      const persisted = svc.getHistory();
      const userMsg = persisted.find((m) => m.role === 'user');
      expect(userMsg?.roundId).toBeTruthy();
      expect(typeof userMsg?.roundId).toBe('string');
    });

    it('regenerates roundId when caller supplies a duplicate', async () => {
      const sess = createMockSession();
      sessions.set('dude', sess);
      minds.length = 0;
      minds.push(makeMind('dude', 'The Dude'));
      autoIdle(sess);

      const dup = 'renderer-dup-id';
      await svc.broadcast('first', dup);
      await svc.broadcast('second', dup);

      const userMsgs = svc.getHistory().filter((m) => m.role === 'user');
      expect(userMsgs).toHaveLength(2);
      expect(userMsgs[0].roundId).toBe(dup);
      expect(userMsgs[1].roundId).not.toBe(dup);
      expect(userMsgs[1].roundId).toBeTruthy();
    });
  });

  describe('approval gate', () => {
    it('passes a permission handler into production chatroom sessions', async () => {
      minds.length = 0;
      minds.push(makeMind('dude', 'The Dude'));

      const sess = createMockSession();
      sessions.set('dude', sess);
      autoIdle(sess);

      await svc.broadcast('Use a side-effecting tool');

      expect(factory.createChatroomSession).toHaveBeenCalledWith('dude', expect.any(Function));
    });

    it('routes side-effect permission requests through the approval gate', async () => {
      minds.length = 0;
      minds.push(makeMind('dude', 'The Dude'));

      const sess = createMockSession();
      sessions.set('dude', sess);
      autoIdle(sess);

      await svc.broadcast('Write a file');

      const permissionHandler = (factory.createChatroomSession as Mock).mock.calls[0][1] as PermissionHandler;
      const decision = await permissionHandler(
        { kind: 'write', toolCallId: 'tool-1', fileName: 'README.md', diff: '', intention: 'write', canOfferSessionApproval: true },
        { sessionId: 'session-1' },
      );

      expect(decision).toEqual({
        kind: 'reject',
        feedback: 'Denied by Chamber approval gate: No approval handler registered — default deny',
      });
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
      expect(factory.createChatroomSession).toHaveBeenCalledWith('dude', expect.any(Function));
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
      expect(factory.createChatroomSession).toHaveBeenCalledWith('dude', expect.any(Function));
    });
  });

  // 18. Disabled minds (participant toggle)
  describe('disabled minds', () => {
    it('defaults to no disabled minds', () => {
      expect(svc.getDisabledMindIds()).toEqual([]);
    });

    it('setMindEnabled(false) excludes the mind from broadcast', async () => {
      const dudeSess = createMockSession();
      const jarvisSess = createMockSession();
      sessions.set('dude', dudeSess);
      sessions.set('jarvis', jarvisSess);
      autoIdle(dudeSess);
      autoIdle(jarvisSess);

      svc.setMindEnabled('dude', false);
      await svc.broadcast('Hello');

      expect(dudeSess.send).not.toHaveBeenCalled();
      expect(jarvisSess.send).toHaveBeenCalled();
    });

    it('setMindEnabled is idempotent and only persists/emits on change', () => {
      const stateChanges: unknown[] = [];
      svc.on('chatroom:state-changed', (s) => stateChanges.push(s));

      svc.setMindEnabled('dude', false);
      svc.setMindEnabled('dude', false); // no-op
      svc.setMindEnabled('dude', true);
      svc.setMindEnabled('dude', true); // no-op

      expect(stateChanges).toHaveLength(2);
      expect(stateChanges[0]).toEqual({ disabledMindIds: ['dude'] });
      expect(stateChanges[1]).toEqual({ disabledMindIds: [] });
    });

    // The three previously-here cases asserted on the legacy `chatroom.json`
    // single-file layout: persisted-disabledMindIds, defensive load of mixed
    // ids, and tolerating a malformed disabledMindIds field. With sessions
    // the disabled-mind set is per-session and lives in the session record,
    // covered by ChatroomSessionStore.test.ts and the session API tests in
    // ChatroomService.sessions.test.ts.

    it('all-disabled produces a system message and no agent invocation', async () => {
      const dudeSess = createMockSession();
      const jarvisSess = createMockSession();
      sessions.set('dude', dudeSess);
      sessions.set('jarvis', jarvisSess);

      svc.setMindEnabled('dude', false);
      svc.setMindEnabled('jarvis', false);
      await svc.broadcast('Hello nobody');

      expect(dudeSess.send).not.toHaveBeenCalled();
      expect(jarvisSess.send).not.toHaveBeenCalled();
      const history = svc.getHistory();
      expect(history).toHaveLength(2);
      expect(history[1].sender.mindId).toBe('system');
    });

    it('handleMindUnloaded prunes the disabled set, persists, and emits', () => {
      const stateChanges: unknown[] = [];
      svc.on('chatroom:state-changed', (s) => stateChanges.push(s));

      svc.setMindEnabled('dude', false);
      stateChanges.length = 0;

      factory.emit('mind:unloaded', 'dude');

      expect(svc.getDisabledMindIds()).toEqual([]);
      expect(stateChanges).toEqual([{ disabledMindIds: [] }]);
    });

    it('handleMindUnloaded for a mind that was not disabled does not emit', () => {
      const stateChanges: unknown[] = [];
      svc.on('chatroom:state-changed', (s) => stateChanges.push(s));

      factory.emit('mind:unloaded', 'jarvis');

      expect(stateChanges).toEqual([]);
    });

    it('clearHistory keeps the disabled set (preference, not transcript content)', async () => {
      svc.setMindEnabled('dude', false);
      await svc.clearHistory();
      expect(svc.getDisabledMindIds()).toEqual(['dude']);
    });

    it('mid-round toggle does not affect the in-flight broadcast (snapshot semantics)', async () => {
      const dudeSess = createMockSession();
      const jarvisSess = createMockSession();
      sessions.set('dude', dudeSess);
      sessions.set('jarvis', jarvisSess);
      autoIdle(dudeSess);
      autoIdle(jarvisSess);

      const broadcastPromise = svc.broadcast('Hello');
      // Toggle mid-flight; snapshot was taken at the top of broadcast.
      svc.setMindEnabled('jarvis', false);
      await broadcastPromise;

      expect(dudeSess.send).toHaveBeenCalled();
      expect(jarvisSess.send).toHaveBeenCalled();
    });
  });

  // 19. Orchestration prerequisites
  describe('orchestration prerequisites', () => {
    it('emits a system message when group-chat moderator is disabled', async () => {
      svc.setOrchestration('group-chat', { moderatorMindId: 'dude', maxTurns: 3, minRounds: 1, maxSpeakerRepeats: 3 });
      svc.setMindEnabled('dude', false);

      const dudeSess = createMockSession();
      const jarvisSess = createMockSession();
      sessions.set('dude', dudeSess);
      sessions.set('jarvis', jarvisSess);

      await svc.broadcast('Discuss');

      expect(dudeSess.send).not.toHaveBeenCalled();
      expect(jarvisSess.send).not.toHaveBeenCalled();
      const history = svc.getHistory();
      expect(history[history.length - 1].sender.mindId).toBe('system');
    });

    it('emits a system message when magentic manager is disabled', async () => {
      svc.setOrchestration('magentic', { managerMindId: 'dude', maxSteps: 3 });
      svc.setMindEnabled('dude', false);

      const dudeSess = createMockSession();
      const jarvisSess = createMockSession();
      sessions.set('dude', dudeSess);
      sessions.set('jarvis', jarvisSess);

      await svc.broadcast('Plan');

      expect(dudeSess.send).not.toHaveBeenCalled();
      expect(jarvisSess.send).not.toHaveBeenCalled();
      const history = svc.getHistory();
      expect(history[history.length - 1].sender.mindId).toBe('system');
    });

    it('emits a system message when magentic has manager but no workers', async () => {
      svc.setOrchestration('magentic', { managerMindId: 'dude', maxSteps: 3 });
      svc.setMindEnabled('jarvis', false);
      minds.length = 1; // only dude (manager) remains

      const dudeSess = createMockSession();
      sessions.set('dude', dudeSess);

      await svc.broadcast('Plan');

      expect(dudeSess.send).not.toHaveBeenCalled();
      const history = svc.getHistory();
      expect(history[history.length - 1].sender.mindId).toBe('system');
    });
  });
});
