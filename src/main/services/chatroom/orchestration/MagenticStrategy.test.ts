import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock node:crypto for UUID generation
const mockRandomUUID = vi.fn(() => 'test-uuid');
vi.mock('node:crypto', () => ({
  randomUUID: () => mockRandomUUID(),
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

    // Manager: first call = plan, second call = assign, third call = synthesis
    autoIdleWithSequence(managerSess, [
      '{"action": "update-plan", "plan": [{"id": "1", "description": "research topic"}]}',
      '{"action": "assign", "assignee": "Worker A", "task_id": "1", "task_description": "research topic"}',
      'All tasks have been completed successfully. The research on AI safety covers key topics.',
    ]);

    autoIdleWith(workerSess, 'Here is my research on the topic.');

    const strategy = new MagenticStrategy({
      managerMindId: 'manager',
      maxSteps: 10,
    });
    const ctx = createContext(sessions);
    const minds = [makeMind('manager', 'Manager'), makeMind('worker-a', 'Worker A')];

    await strategy.execute('Research AI safety', minds, 'round-1', ctx);

    // Manager called 3 times: plan + assign + synthesis
    expect(managerSess.send).toHaveBeenCalledTimes(3);
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

  // -------------------------------------------------------------------------
  // v2: Batch assignments + parallel A2A dispatch
  // -------------------------------------------------------------------------

  it('supports batch assignments via assignments array', async () => {
    const managerSess = createMockSession();
    const workerASess = createMockSession();
    const workerBSess = createMockSession();
    sessions.set('manager', managerSess);
    sessions.set('worker-a', workerASess);
    sessions.set('worker-b', workerBSess);

    autoIdleWithSequence(managerSess, [
      '{"action": "update-plan", "plan": [{"id": "1", "description": "task A"}, {"id": "2", "description": "task B"}]}',
      '{"action": "assign", "assignments": [{"assignee": "Worker A", "task_id": "1", "task_description": "do A"}, {"assignee": "Worker B", "task_id": "2", "task_description": "do B"}]}',
      '{"action": "complete", "summary": "All done"}',
    ]);

    autoIdleWith(workerASess, 'A result');
    autoIdleWith(workerBSess, 'B result');

    const strategy = new MagenticStrategy({ managerMindId: 'manager', maxSteps: 10 });
    const ctx = createContext(sessions);
    const minds = [makeMind('manager', 'Manager'), makeMind('worker-a', 'Worker A'), makeMind('worker-b', 'Worker B')];

    await strategy.execute('Do both tasks', minds, 'round-1', ctx);

    // Both workers called (sequential fallback — no A2A)
    expect(workerASess.send).toHaveBeenCalledTimes(1);
    expect(workerBSess.send).toHaveBeenCalledTimes(1);
  });

  it('falls back to sequential when dispatchTask is not available', async () => {
    const managerSess = createMockSession();
    const workerSess = createMockSession();
    sessions.set('manager', managerSess);
    sessions.set('worker-a', workerSess);

    autoIdleWithSequence(managerSess, [
      '{"action": "update-plan", "plan": [{"id": "1", "description": "task"}]}',
      '{"action": "assign", "assignee": "Worker A", "task_id": "1", "task_description": "do it"}',
      '{"action": "complete", "summary": "done"}',
    ]);
    autoIdleWith(workerSess, 'Done');

    const strategy = new MagenticStrategy({ managerMindId: 'manager', maxSteps: 10 });
    // No dispatchTask — should use sequential path
    const ctx = createContext(sessions);
    expect(ctx.dispatchTask).toBeUndefined();

    const minds = [makeMind('manager', 'Manager'), makeMind('worker-a', 'Worker A')];
    await strategy.execute('Test', minds, 'round-1', ctx);

    expect(workerSess.send).toHaveBeenCalledTimes(1);
  });

  it('batch assignments with dispatchTask available still execute sequentially', async () => {
    const managerSess = createMockSession();
    const workerASess = createMockSession();
    const workerBSess = createMockSession();
    sessions.set('manager', managerSess);
    sessions.set('worker-a', workerASess);
    sessions.set('worker-b', workerBSess);

    autoIdleWithSequence(managerSess, [
      '{"action": "update-plan", "plan": [{"id": "1", "description": "task A"}, {"id": "2", "description": "task B"}]}',
      '{"action": "assign", "assignments": [{"assignee": "Worker A", "task_id": "1"}, {"assignee": "Worker B", "task_id": "2"}]}',
      '{"action": "complete", "summary": "done"}',
    ]);

    autoIdleWith(workerASess, 'A done');
    autoIdleWith(workerBSess, 'B done');

    const mockDispatch = vi.fn();

    const strategy = new MagenticStrategy({ managerMindId: 'manager', maxSteps: 10 });
    const ctx = createContext(sessions, { dispatchTask: mockDispatch, pollTask: vi.fn() });
    const minds = [makeMind('manager', 'Manager'), makeMind('worker-a', 'Worker A'), makeMind('worker-b', 'Worker B')];

    await strategy.execute('Test', minds, 'round-1', ctx);

    // A2A dispatch never called — always sequential now
    expect(mockDispatch).not.toHaveBeenCalled();
    // Both workers called sequentially
    expect(workerASess.send).toHaveBeenCalledTimes(1);
    expect(workerBSess.send).toHaveBeenCalledTimes(1);
  });

  it('worker prompts use natural language, not XML directives', async () => {
    const managerSess = createMockSession();
    const workerSess = createMockSession();
    sessions.set('manager', managerSess);
    sessions.set('worker-a', workerSess);

    autoIdleWithSequence(managerSess, [
      '{"action": "update-plan", "plan": [{"id": "1", "description": "research topic"}]}',
      '{"action": "assign", "assignee": "Worker A", "task_id": "1", "task_description": "research AI safety"}',
      '{"action": "complete", "summary": "done"}',
    ]);

    let capturedPrompt = '';
    workerSess.send.mockImplementation(async (opts: { prompt: string }) => {
      capturedPrompt = opts.prompt;
      setTimeout(() => {
        workerSess._emit('assistant.message', { data: { messageId: 'sdk-1', content: 'Result' } });
        workerSess._emit('session.idle', {});
      }, 0);
    });

    const strategy = new MagenticStrategy({ managerMindId: 'manager', maxSteps: 10 });
    const ctx = createContext(sessions);
    const minds = [makeMind('manager', 'Manager'), makeMind('worker-a', 'Worker A')];

    await strategy.execute('Research AI safety', minds, 'round-1', ctx);

    // Worker prompt should NOT contain XML directives
    expect(capturedPrompt).not.toContain('<assigned-task');
    expect(capturedPrompt).not.toContain('<completed-tasks');
    // Should contain natural language task description (from ledger, not assign)
    expect(capturedPrompt).toContain('Your task:');
    expect(capturedPrompt).toContain('research topic');
  });

  // -------------------------------------------------------------------------
  // v2: Synthetic message rendering (Issue 1 fix)
  // -------------------------------------------------------------------------

  it('emits message_final + done events for synthetic plan messages', async () => {
    const managerSess = createMockSession();
    const workerSess = createMockSession();
    sessions.set('manager', managerSess);
    sessions.set('worker-a', workerSess);

    autoIdleWithSequence(managerSess, [
      '{"action": "update-plan", "plan": [{"id": "1", "description": "research topic"}]}',
      '{"action": "assign", "assignee": "Worker A", "task_id": "1", "task_description": "research topic"}',
      '{"action": "complete", "summary": "All done"}',
    ]);
    autoIdleWith(workerSess, 'Result text');

    const strategy = new MagenticStrategy({ managerMindId: 'manager', maxSteps: 10 });
    const ctx = createContext(sessions);
    const minds = [makeMind('manager', 'Manager'), makeMind('worker-a', 'Worker A')];

    await strategy.execute('Research AI', minds, 'round-1', ctx);

    const events = (ctx as unknown as { _events: ChatroomStreamEvent[] })._events;

    // Should have message_final events for synthetic plan/assign messages
    const messageFinals = events.filter((e) => e.event.type === 'message_final');
    expect(messageFinals.length).toBeGreaterThanOrEqual(1);

    // Each message_final should have a corresponding done event with the same messageId
    for (const mf of messageFinals) {
      const matchingDone = events.find(
        (e) => e.event.type === 'done' && e.messageId === mf.messageId,
      );
      expect(matchingDone).toBeDefined();
      // messageId should not be empty
      expect(mf.messageId).not.toBe('');
    }

    // Persisted messages should match the emitted messageIds
    const persisted = (ctx as unknown as { _messages: ChatroomMessage[] })._messages;
    for (const mf of messageFinals) {
      const matching = persisted.find((m) => m.id === mf.messageId);
      expect(matching).toBeDefined();
    }
  });

  it('synthetic messages contain formatted plan content, not raw JSON', async () => {
    const managerSess = createMockSession();
    const workerSess = createMockSession();
    sessions.set('manager', managerSess);
    sessions.set('worker-a', workerSess);

    autoIdleWithSequence(managerSess, [
      '{"action": "update-plan", "plan": [{"id": "1", "description": "first task"}, {"id": "2", "description": "second task"}]}',
      '{"action": "assign", "assignee": "Worker A", "task_id": "1", "task_description": "first task"}',
      '{"action": "complete", "summary": "done"}',
    ]);
    autoIdleWith(workerSess, 'Done');

    const strategy = new MagenticStrategy({ managerMindId: 'manager', maxSteps: 10 });
    const ctx = createContext(sessions);
    const minds = [makeMind('manager', 'Manager'), makeMind('worker-a', 'Worker A')];

    await strategy.execute('Do stuff', minds, 'round-1', ctx);

    const persisted = (ctx as unknown as { _messages: ChatroomMessage[] })._messages;
    const planMsg = persisted.find((m) =>
      m.blocks.some((b) => b.type === 'text' && b.content.includes('**Planning:**')),
    );
    expect(planMsg).toBeDefined();
    expect(planMsg!.blocks[0]).toMatchObject({
      type: 'text',
      content: expect.stringContaining('first task'),
    });
  });

  // -------------------------------------------------------------------------
  // v2: Worker timeout handling (Issue 2 fix)
  // -------------------------------------------------------------------------

  it('marks task as failed when worker times out', async () => {
    const managerSess = createMockSession();
    const workerSess = createMockSession();
    sessions.set('manager', managerSess);
    sessions.set('worker-a', workerSess);

    autoIdleWithSequence(managerSess, [
      '{"action": "update-plan", "plan": [{"id": "1", "description": "slow task"}]}',
      '{"action": "assign", "assignee": "Worker A", "task_id": "1", "task_description": "slow task"}',
      '{"action": "complete", "summary": "Worker timed out"}',
    ]);

    // Worker send resolves but session.idle never fires — simulates a hang
    workerSess.send.mockResolvedValue(undefined);

    const strategy = new MagenticStrategy({ managerMindId: 'manager', maxSteps: 10 });
    const ctx = createContext(sessions);
    const minds = [makeMind('manager', 'Manager'), makeMind('worker-a', 'Worker A')];

    // Override getOrCreateSession to return pre-created sessions consistently
    (ctx.getOrCreateSession as ReturnType<typeof vi.fn>).mockImplementation(async (mindId: string) => {
      if (mindId === 'manager') return managerSess;
      return workerSess;
    });

    await strategy.execute('Do slow thing', minds, 'round-1', ctx);

    // Worker was called
    expect(workerSess.send).toHaveBeenCalled();

    // Task ledger should show the task as failed
    const events = (ctx as unknown as { _events: ChatroomStreamEvent[] })._events;
    const ledgerUpdates = events.filter(
      (e) => e.event.type === 'orchestration:task-ledger-update',
    );
    const lastLedger = ledgerUpdates[ledgerUpdates.length - 1];
    expect(lastLedger).toBeDefined();

    const ledgerData = (lastLedger.event as unknown as { data: { ledger: Array<{ status: string }> } }).data.ledger;
    const failedTask = ledgerData.find((t) => t.status === 'failed');
    expect(failedTask).toBeDefined();
  }, 180_000); // Extended timeout — worker timeout is 120s

  it('worker prompt includes conciseness and tool-limit guidance', async () => {
    const managerSess = createMockSession();
    const workerSess = createMockSession();
    sessions.set('manager', managerSess);
    sessions.set('worker-a', workerSess);

    autoIdleWithSequence(managerSess, [
      '{"action": "update-plan", "plan": [{"id": "1", "description": "research topic"}]}',
      '{"action": "assign", "assignee": "Worker A", "task_id": "1", "task_description": "research AI safety"}',
      '{"action": "complete", "summary": "done"}',
    ]);

    let capturedPrompt = '';
    workerSess.send.mockImplementation(async (opts: { prompt: string }) => {
      capturedPrompt = opts.prompt;
      setTimeout(() => {
        workerSess._emit('assistant.message', { data: { messageId: 'sdk-1', content: 'Result' } });
        workerSess._emit('session.idle', {});
      }, 0);
    });

    const strategy = new MagenticStrategy({ managerMindId: 'manager', maxSteps: 10 });
    const ctx = createContext(sessions);
    const minds = [makeMind('manager', 'Manager'), makeMind('worker-a', 'Worker A')];

    await strategy.execute('Research AI safety', minds, 'round-1', ctx);

    expect(capturedPrompt).toContain('Respond concisely and directly');
    expect(capturedPrompt).toContain('Limit tool usage');
  });
});
