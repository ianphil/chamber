import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock node:crypto for UUID generation
const mockRandomUUID = vi.fn(() => 'test-uuid');
vi.mock('node:crypto', () => ({
  randomUUID: (...args: unknown[]) => mockRandomUUID(...args),
}));

import { MagenticStrategy } from './MagenticStrategy';
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

function autoIdleWithSequence(session: ReturnType<typeof createMockSession>, contents: string[]) {
  let callIndex = 0;
  session.send.mockImplementation(async () => {
    const content = contents[callIndex] ?? contents[contents.length - 1];
    callIndex++;
    setTimeout(() => {
      session._emit('assistant.message', {
        data: { messageId: `sdk-msg-${callIndex}`, content },
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
    buildBasePrompt: vi.fn(() => '<message sender="You">test</message>'),
    emitEvent: vi.fn((event: ChatroomStreamEvent) => events.push(event)),
    persistMessage: vi.fn((msg: ChatroomMessage) => messages.push(msg)),
    getHistory: vi.fn(() => []),
    orchestrationMode: 'magentic',
    _events: events,
    _messages: messages,
    ...overrides,
  } as OrchestrationContext & { _events: ChatroomStreamEvent[]; _messages: ChatroomMessage[] };
}

let uuidCounter = 0;
function resetUUIDs() {
  uuidCounter = 0;
  mockRandomUUID.mockImplementation(() => `uuid-${++uuidCounter}`);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MagenticStrategy', () => {
  let sessions: Map<string, ReturnType<typeof createMockSession>>;

  beforeEach(() => {
    vi.clearAllMocks();
    resetUUIDs();
    sessions = new Map();
  });

  it('manager creates plan, assigns to worker, then completes', async () => {
    const managerSess = createMockSession();
    const workerSess = createMockSession();
    sessions.set('manager', managerSess);
    sessions.set('worker-a', workerSess);

    // Manager: first call = plan, second call = assign, third call = complete
    autoIdleWithSequence(managerSess, [
      '{"action": "update-plan", "plan": [{"id": "1", "description": "research topic"}]}',
      '{"action": "assign", "assignee": "Worker A", "task_id": "1", "task_description": "research topic"}',
      '{"action": "complete", "summary": "All done"}',
    ]);

    autoIdleWith(workerSess, 'Here is my research on the topic.');

    const strategy = new MagenticStrategy({
      managerMindId: 'manager',
      maxSteps: 10,
    });
    const ctx = createContext(sessions);
    const minds = [makeMind('manager', 'Manager'), makeMind('worker-a', 'Worker A')];

    await strategy.execute('Research AI safety', minds, 'round-1', ctx);

    // Manager called 2 times: plan + assign (loop exits when all tasks complete)
    expect(managerSess.send).toHaveBeenCalledTimes(2);
    // Worker should have been called once
    expect(workerSess.send).toHaveBeenCalledTimes(1);

    // All tasks completed — should have emitted ledger updates
    const ledgerEvents = (ctx as unknown as { _events: ChatroomStreamEvent[] })._events.filter(
      (e) => e.event.type === 'orchestration:task-ledger-update',
    );
    expect(ledgerEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('enforces step budget — no infinite loops', async () => {
    const managerSess = createMockSession();
    const workerSess = createMockSession();
    sessions.set('manager', managerSess);
    sessions.set('worker-a', workerSess);

    // Manager always assigns — never completes
    autoIdleWithSequence(managerSess, [
      '{"action": "update-plan", "plan": [{"id": "1", "description": "infinite task"}]}',
      '{"action": "assign", "assignee": "Worker A", "task_id": "1", "task_description": "do something"}',
      '{"action": "assign", "assignee": "Worker A", "task_id": "1", "task_description": "do more"}',
      '{"action": "assign", "assignee": "Worker A", "task_id": "1", "task_description": "even more"}',
    ]);

    autoIdleWith(workerSess, 'Done with this step');

    const strategy = new MagenticStrategy({
      managerMindId: 'manager',
      maxSteps: 3,
    });
    const ctx = createContext(sessions);
    const minds = [makeMind('manager', 'Manager'), makeMind('worker-a', 'Worker A')];

    await strategy.execute('Infinite task', minds, 'round-1', ctx);

    // Manager: 1 plan call + 3 assign calls = 4 total max
    // Worker: up to 3 times (one per step)
    // The step budget should cap execution
    expect(workerSess.send.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('manager can only select agents from the allowlist', async () => {
    const managerSess = createMockSession();
    const allowedSess = createMockSession();
    const deniedSess = createMockSession();
    sessions.set('manager', managerSess);
    sessions.set('allowed', allowedSess);
    sessions.set('denied', deniedSess);

    autoIdleWithSequence(managerSess, [
      '{"action": "update-plan", "plan": [{"id": "1", "description": "task"}]}',
      // Manager tries to assign to denied agent (not in allowlist)
      '{"action": "assign", "assignee": "Denied Agent", "task_id": "1", "task_description": "do it"}',
      // Then assigns to allowed agent
      '{"action": "assign", "assignee": "Allowed Agent", "task_id": "1", "task_description": "do it"}',
      '{"action": "complete", "summary": "done"}',
    ]);

    autoIdleWith(allowedSess, 'Done');

    const strategy = new MagenticStrategy({
      managerMindId: 'manager',
      maxSteps: 10,
      allowedMindIds: ['manager', 'allowed'],
    });
    const ctx = createContext(sessions);
    const minds = [
      makeMind('manager', 'Manager'),
      makeMind('allowed', 'Allowed Agent'),
      makeMind('denied', 'Denied Agent'),
    ];

    await strategy.execute('Test', minds, 'round-1', ctx);

    // Denied agent should never have been called
    expect(deniedSess.send).not.toHaveBeenCalled();
    // Allowed agent should have been called
    expect(allowedSess.send).toHaveBeenCalledTimes(1);
  });

  it('emits task-ledger-update events', async () => {
    const managerSess = createMockSession();
    const workerSess = createMockSession();
    sessions.set('manager', managerSess);
    sessions.set('worker-a', workerSess);

    autoIdleWithSequence(managerSess, [
      '{"action": "update-plan", "plan": [{"id": "1", "description": "task one"}]}',
      '{"action": "assign", "assignee": "Worker A", "task_id": "1", "task_description": "task one"}',
      '{"action": "complete", "summary": "done"}',
    ]);

    autoIdleWith(workerSess, 'Completed');

    const strategy = new MagenticStrategy({
      managerMindId: 'manager',
      maxSteps: 10,
    });
    const ctx = createContext(sessions);
    const minds = [makeMind('manager', 'Manager'), makeMind('worker-a', 'Worker A')];

    await strategy.execute('Test', minds, 'round-1', ctx);

    const ledgerEvents = (ctx as unknown as { _events: ChatroomStreamEvent[] })._events.filter(
      (e) => e.event.type === 'orchestration:task-ledger-update',
    );
    // Should have at least 3 ledger updates: initial plan, task assigned, task completed
    expect(ledgerEvents.length).toBeGreaterThanOrEqual(3);
  });

  it('handles missing manager gracefully', async () => {
    const strategy = new MagenticStrategy({
      managerMindId: 'nonexistent',
      maxSteps: 10,
    });
    const ctx = createContext(sessions);
    const minds = [makeMind('worker-a', 'Worker A')];

    // Should not throw
    await strategy.execute('Test', minds, 'round-1', ctx);
  });

  it('handles no workers gracefully', async () => {
    const managerSess = createMockSession();
    sessions.set('manager', managerSess);

    const strategy = new MagenticStrategy({
      managerMindId: 'manager',
      maxSteps: 10,
    });
    const ctx = createContext(sessions);
    const minds = [makeMind('manager', 'Manager')];

    await strategy.execute('Test', minds, 'round-1', ctx);

    // Manager should never be called as a worker
    expect(managerSess.send).not.toHaveBeenCalled();
  });

  it('stop() aborts execution', async () => {
    const managerSess = createMockSession();
    sessions.set('manager', managerSess);

    // Manager send resolves but never emits idle
    managerSess.send.mockImplementation(async () => {
      // Never emit idle
    });

    const strategy = new MagenticStrategy({
      managerMindId: 'manager',
      maxSteps: 10,
    });
    const ctx = createContext(sessions);
    const minds = [makeMind('manager', 'Manager'), makeMind('worker-a', 'Worker A')];

    const executePromise = strategy.execute('Test', minds, 'round-1', ctx);

    // Wait for send to be called, then stop
    await vi.waitFor(() => expect(managerSess.send).toHaveBeenCalled());
    strategy.stop();

    await executePromise;

    // Should not have persisted any messages from workers
    expect(ctx.persistMessage).not.toHaveBeenCalled();
  });
});
