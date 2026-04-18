import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock node:crypto for UUID generation
const mockRandomUUID = vi.fn(() => 'test-uuid');
vi.mock('node:crypto', () => ({
  randomUUID: (...args: unknown[]) => mockRandomUUID(...args),
}));

import { HandoffStrategy } from './HandoffStrategy';
import type { OrchestrationContext } from './types';
import type { MindContext } from '../../../../shared/types';
import type { ChatroomStreamEvent, ChatroomMessage } from '../../../../shared/chatroom-types';

// ---------------------------------------------------------------------------
// Helpers — consistent with existing test patterns
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
    buildBasePrompt: vi.fn(() => '<message sender="You">test</message>'),
    emitEvent: vi.fn((event: ChatroomStreamEvent) => events.push(event)),
    persistMessage: vi.fn((msg: ChatroomMessage) => messages.push(msg)),
    getHistory: vi.fn(() => []),
    orchestrationMode: 'handoff',
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

describe('HandoffStrategy', () => {
  let sessions: Map<string, ReturnType<typeof createMockSession>>;

  beforeEach(() => {
    vi.clearAllMocks();
    resetUUIDs();
    sessions = new Map();
  });

  it('starts with initial agent and terminates on "done"', async () => {
    const sess = createMockSession();
    sessions.set('agent-a', sess);
    autoIdleWith(sess, 'I handled it. {"action": "done", "reason": "task complete"}');

    const strategy = new HandoffStrategy({ maxHandoffHops: 5 });
    const ctx = createContext(sessions);
    const minds = [makeMind('agent-a', 'Alpha'), makeMind('agent-b', 'Beta')];

    await strategy.execute('Help me', minds, 'round-1', ctx);

    expect(sess.send).toHaveBeenCalledTimes(1);
    // Should have emitted a handoff-terminated event with DONE reason
    const terminatedEvents = (ctx as unknown as { _events: ChatroomStreamEvent[] })._events.filter(
      (e) => e.event.type === 'orchestration:handoff-terminated',
    );
    expect(terminatedEvents).toHaveLength(1);
    expect((terminatedEvents[0].event as { data: Record<string, unknown> }).data.reason).toBe('DONE');
  });

  it('hands off from agent A to agent B', async () => {
    const sessA = createMockSession();
    const sessB = createMockSession();
    sessions.set('agent-a', sessA);
    sessions.set('agent-b', sessB);

    autoIdleWith(sessA, 'I need help. {"action": "handoff", "target_agent": "Beta", "reason": "Beta knows this", "task_context": "need expertise"}');
    autoIdleWith(sessB, 'I handled it. {"action": "done", "reason": "resolved"}');

    const strategy = new HandoffStrategy({ maxHandoffHops: 5 });
    const ctx = createContext(sessions);
    const minds = [makeMind('agent-a', 'Alpha'), makeMind('agent-b', 'Beta')];

    await strategy.execute('Help me', minds, 'round-1', ctx);

    expect(sessA.send).toHaveBeenCalledTimes(1);
    expect(sessB.send).toHaveBeenCalledTimes(1);

    // Should have emitted a handoff event
    const handoffEvents = (ctx as unknown as { _events: ChatroomStreamEvent[] })._events.filter(
      (e) => e.event.type === 'orchestration:handoff',
    );
    expect(handoffEvents).toHaveLength(1);
    expect((handoffEvents[0].event as { data: Record<string, unknown> }).data.from).toBe('Alpha');
    expect((handoffEvents[0].event as { data: Record<string, unknown> }).data.to).toBe('Beta');
  });

  it('enforces maxHandoffHops limit', async () => {
    // Set up agents that always hand off to each other
    const sessA = createMockSession();
    const sessB = createMockSession();
    const sessC = createMockSession();
    sessions.set('agent-a', sessA);
    sessions.set('agent-b', sessB);
    sessions.set('agent-c', sessC);

    // Each agent always hands off to the next unique agent (A→B→C→done but with maxHops=2)
    autoIdleWith(sessA, '{"action": "handoff", "target_agent": "Beta", "reason": "need Beta"}');
    autoIdleWith(sessB, '{"action": "handoff", "target_agent": "Gamma", "reason": "need Gamma"}');
    autoIdleWith(sessC, '{"action": "handoff", "target_agent": "Alpha", "reason": "need Alpha"}');

    const strategy = new HandoffStrategy({ maxHandoffHops: 2 });
    const ctx = createContext(sessions);
    const minds = [
      makeMind('agent-a', 'Alpha'),
      makeMind('agent-b', 'Beta'),
      makeMind('agent-c', 'Gamma'),
    ];

    await strategy.execute('Help', minds, 'round-1', ctx);

    // Should have been capped at 2 hops
    expect(sessA.send).toHaveBeenCalledTimes(1);
    expect(sessB.send).toHaveBeenCalledTimes(1);
    expect(sessC.send).not.toHaveBeenCalled();

    const terminatedEvents = (ctx as unknown as { _events: ChatroomStreamEvent[] })._events.filter(
      (e) => e.event.type === 'orchestration:handoff-terminated',
    );
    expect(terminatedEvents).toHaveLength(1);
    expect((terminatedEvents[0].event as { data: Record<string, unknown> }).data.reason).toBe('MAX_HOPS');
  });

  it('detects loops (A→B→A)', async () => {
    const sessA = createMockSession();
    const sessB = createMockSession();
    sessions.set('agent-a', sessA);
    sessions.set('agent-b', sessB);

    autoIdleWith(sessA, '{"action": "handoff", "target_agent": "Beta", "reason": "need Beta"}');
    autoIdleWith(sessB, '{"action": "handoff", "target_agent": "Alpha", "reason": "need Alpha back"}');

    const strategy = new HandoffStrategy({ maxHandoffHops: 10 });
    const ctx = createContext(sessions);
    const minds = [makeMind('agent-a', 'Alpha'), makeMind('agent-b', 'Beta')];

    await strategy.execute('Help', minds, 'round-1', ctx);

    // A→B→(A is loop) — should detect loop before invoking A again
    expect(sessA.send).toHaveBeenCalledTimes(1);
    expect(sessB.send).toHaveBeenCalledTimes(1);

    const terminatedEvents = (ctx as unknown as { _events: ChatroomStreamEvent[] })._events.filter(
      (e) => e.event.type === 'orchestration:handoff-terminated',
    );
    expect(terminatedEvents).toHaveLength(1);
    expect((terminatedEvents[0].event as { data: Record<string, unknown> }).data.reason).toBe('LOOP_DETECTED');
  });

  it('preserves conversational context across handoffs', async () => {
    const sessA = createMockSession();
    const sessB = createMockSession();
    sessions.set('agent-a', sessA);
    sessions.set('agent-b', sessB);

    autoIdleWith(sessA, 'Alpha analysis here. {"action": "handoff", "target_agent": "Beta", "reason": "expertise needed"}');

    let betaPrompt = '';
    sessB.send.mockImplementation(async (opts: { prompt: string }) => {
      betaPrompt = opts.prompt;
      setTimeout(() => {
        sessB._emit('assistant.message', {
          data: { messageId: 'sdk-2', content: '{"action": "done", "reason": "complete"}' },
        });
        sessB._emit('session.idle', {});
      }, 0);
    });

    const strategy = new HandoffStrategy({ maxHandoffHops: 5 });
    const ctx = createContext(sessions);
    const minds = [makeMind('agent-a', 'Alpha'), makeMind('agent-b', 'Beta')];

    await strategy.execute('Analyze this', minds, 'round-1', ctx);

    // Beta's prompt should contain Alpha's response as transcript context
    expect(betaPrompt).toContain('<handoff-transcript>');
    expect(betaPrompt).toContain('Alpha');
    expect(betaPrompt).toContain('Alpha analysis here');
  });

  it('uses configured initialMindId', async () => {
    const sessA = createMockSession();
    const sessB = createMockSession();
    sessions.set('agent-a', sessA);
    sessions.set('agent-b', sessB);

    autoIdleWith(sessB, '{"action": "done", "reason": "done"}');

    const strategy = new HandoffStrategy({ initialMindId: 'agent-b', maxHandoffHops: 5 });
    const ctx = createContext(sessions);
    const minds = [makeMind('agent-a', 'Alpha'), makeMind('agent-b', 'Beta')];

    await strategy.execute('Help', minds, 'round-1', ctx);

    // Should have started with Beta, not Alpha
    expect(sessA.send).not.toHaveBeenCalled();
    expect(sessB.send).toHaveBeenCalledTimes(1);
  });

  it('stop() aborts in-flight execution', async () => {
    const sess = createMockSession();
    sessions.set('agent-a', sess);

    // Session send resolves but never emits idle — simulates long-running agent
    sess.send.mockImplementation(async () => {
      // Don't emit idle — wait for abort
    });

    const strategy = new HandoffStrategy({ maxHandoffHops: 5 });
    const ctx = createContext(sessions);
    const minds = [makeMind('agent-a', 'Alpha')];

    // Start execution — stop after the send has been called
    const executePromise = strategy.execute('Help', minds, 'round-1', ctx);

    // Wait for send to be called, then stop
    await vi.waitFor(() => expect(sess.send).toHaveBeenCalled());
    strategy.stop();

    await executePromise;

    // Should not have persisted any message
    expect(ctx.persistMessage).not.toHaveBeenCalled();
  });

  it('handles no participants gracefully', async () => {
    const strategy = new HandoffStrategy({ maxHandoffHops: 5 });
    const ctx = createContext(sessions);

    await strategy.execute('Help', [], 'round-1', ctx);

    // Should be a no-op
    expect(ctx.emitEvent).not.toHaveBeenCalled();
  });

  it('handles agent error without crashing', async () => {
    const sess = createMockSession();
    sessions.set('agent-a', sess);

    sess.send.mockImplementation(async () => {
      setTimeout(() => {
        sess._emit('session.error', { data: { message: 'agent crashed' } });
      }, 0);
    });

    const strategy = new HandoffStrategy({ maxHandoffHops: 5 });
    const ctx = createContext(sessions);
    const minds = [makeMind('agent-a', 'Alpha')];

    // Should not throw
    await strategy.execute('Help', minds, 'round-1', ctx);

    const terminatedEvents = (ctx as unknown as { _events: ChatroomStreamEvent[] })._events.filter(
      (e) => e.event.type === 'orchestration:handoff-terminated',
    );
    expect(terminatedEvents).toHaveLength(1);
    expect((terminatedEvents[0].event as { data: Record<string, unknown> }).data.reason).toBe('ERROR');
  });
});
