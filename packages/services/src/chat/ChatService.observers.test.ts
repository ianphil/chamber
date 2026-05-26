/**
 * Phase 6 — TurnCompletionObserver wiring in ChatService.
 *
 * The success contract is exact: every observer is notified exactly once per
 * turn that reached the SDK `done` state, with the full CompletedTurn
 * payload. Aborted turns, errored turns, and SDK contract drift all suppress
 * notification. One observer throwing — sync or async — must not block any
 * other observer and must not leak back into the streaming path.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatService } from './ChatService';
import { TurnQueue } from './TurnQueue';
import type { MindManager } from '../mind';
import type { CompletedTurn, TurnCompletionObserver } from '@chamber/shared/turn-observer';

interface SessionListeners {
  idle: Array<() => void>;
  error: Array<(event: unknown) => void>;
  message: Array<(event: unknown) => void>;
  delta: Array<(event: unknown) => void>;
}

function createMockSession() {
  const listeners: SessionListeners = { idle: [], error: [], message: [], delta: [] };
  const session = {
    send: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'session.idle') listeners.idle.push(cb as () => void);
      else if (event === 'session.error') listeners.error.push(cb as (event: unknown) => void);
      else if (event === 'assistant.message') listeners.message.push(cb as (event: unknown) => void);
      else if (event === 'assistant.message_delta') listeners.delta.push(cb as (event: unknown) => void);
      return vi.fn();
    }),
  };
  return { session, listeners };
}

function createMockManager(session: unknown) {
  return {
    getMind: vi.fn(() => ({
      session,
      client: { listModels: vi.fn(async () => []) },
      activeSessionId: 'sdk-session-abc',
      selectedModel: 'gpt-5.4',
    })),
    setMindModel: vi.fn(async () => null),
    recoverActiveConversationSession: vi.fn(),
    markActiveConversationHasMessages: vi.fn(),
    listConversationHistory: vi.fn(() => []),
    startNewConversation: vi.fn(),
    resumeConversation: vi.fn(),
    deleteConversation: vi.fn(),
    renameConversation: vi.fn(() => []),
    recycleClientForMind: vi.fn(),
    reloadMind: vi.fn(),
  };
}

const dateTimeProvider = () => ({
  currentDateTime: '2026-05-12T17:00:00.000Z',
  timezone: 'America/New_York',
});

describe('ChatService — TurnCompletionObserver wiring (Phase 6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('notifies every observer exactly once per successful turn with the full CompletedTurn payload', async () => {
    const { session, listeners } = createMockSession();
    const mgr = createMockManager(session);
    session.send.mockImplementation(async () => {
      // Final assistant message arrives between send and idle.
      listeners.message.forEach((cb) =>
        cb({ data: { messageId: 'sdk-msg-1', content: 'pong' } }),
      );
      listeners.idle.forEach((cb) => cb());
    });

    const captured: CompletedTurn[] = [];
    const observerA: TurnCompletionObserver = { onTurnCompleted: (t) => { captured.push(t); } };
    const observerB: TurnCompletionObserver = { onTurnCompleted: (t) => { captured.push(t); } };

    const svc = new ChatService(
      mgr as unknown as MindManager,
      new TurnQueue(),
      dateTimeProvider,
    );
    svc.addObserver(observerA);
    svc.addObserver(observerB);

    await svc.sendMessage('mind-1', 'ping', 'msg-1', vi.fn());

    expect(captured).toHaveLength(2);
    const [a, b] = captured;
    expect(a).toEqual(b);
    expect(a.prompt).toBe('ping');
    expect(a.finalAssistantMessage).toBe('pong');
    expect(a.sessionId).toBe('sdk-session-abc');
    expect(a.model).toBe('gpt-5.4');
    expect(a.status).toBe('completed');
    expect(typeof a.turnId).toBe('string');
    expect(a.turnId.length).toBeGreaterThan(0);
    expect(typeof a.startedAt).toBe('string');
    expect(typeof a.endedAt).toBe('string');
    expect(Date.parse(a.startedAt)).not.toBeNaN();
    expect(Date.parse(a.endedAt)).not.toBeNaN();
    expect(Date.parse(a.endedAt)).toBeGreaterThanOrEqual(Date.parse(a.startedAt));
  });

  it('uses the explicitly-requested model from sendMessage when provided', async () => {
    const { session, listeners } = createMockSession();
    const mgr = createMockManager(session);
    session.send.mockImplementation(async () => {
      listeners.message.forEach((cb) => cb({ data: { messageId: 'm', content: 'hi' } }));
      listeners.idle.forEach((cb) => cb());
    });

    const captured: CompletedTurn[] = [];
    const svc = new ChatService(
      mgr as unknown as MindManager,
      new TurnQueue(),
      dateTimeProvider,
    );
    svc.addObserver({ onTurnCompleted: (t) => { captured.push(t); } });

    await svc.sendMessage('mind-1', 'hi', 'msg-1', vi.fn(), 'opus-4.7');

    expect(captured).toHaveLength(1);
    expect(captured[0].model).toBe('opus-4.7');
  });

  it('does NOT notify observers when the user aborts the turn mid-stream', async () => {
    const { session, listeners } = createMockSession();
    const mgr = createMockManager(session);
    // session.idle never fires; we abort externally.
    session.send.mockResolvedValue(undefined);

    const observer = { onTurnCompleted: vi.fn() };
    const svc = new ChatService(
      mgr as unknown as MindManager,
      new TurnQueue(),
      dateTimeProvider,
    );
    svc.addObserver(observer);

    const pending = svc.sendMessage('mind-1', 'long-running', 'msg-1', vi.fn());
    // Allow the queue/streamTurn to wire up listeners and call send.
    for (let i = 0; i < 10; i++) await Promise.resolve();
    // Even if the assistant text was captured before abort, abort suppresses notification.
    listeners.message.forEach((cb) => cb({ data: { messageId: 'm', content: 'partial' } }));
    await svc.cancelMessage('mind-1', 'msg-1');
    await pending;

    expect(observer.onTurnCompleted).not.toHaveBeenCalled();
  });

  it('does NOT notify observers when the SDK signals session.error', async () => {
    const { session, listeners } = createMockSession();
    const mgr = createMockManager(session);
    session.send.mockImplementation(async () => {
      listeners.error.forEach((cb) => cb({ data: { message: 'boom' } }));
    });

    const observer = { onTurnCompleted: vi.fn() };
    const svc = new ChatService(
      mgr as unknown as MindManager,
      new TurnQueue(),
      dateTimeProvider,
    );
    svc.addObserver(observer);

    const emit = vi.fn();
    await svc.sendMessage('mind-1', 'hi', 'msg-1', emit);

    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    expect(observer.onTurnCompleted).not.toHaveBeenCalled();
  });

  it('does NOT notify observers when sendMessage rejects synchronously (mind missing)', async () => {
    const mgr = createMockManager(null);
    mgr.getMind.mockReturnValue(undefined as never);

    const observer = { onTurnCompleted: vi.fn() };
    const svc = new ChatService(
      mgr as unknown as MindManager,
      new TurnQueue(),
      dateTimeProvider,
    );
    svc.addObserver(observer);

    const emit = vi.fn();
    await svc.sendMessage('missing', 'hi', 'msg-1', emit);

    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    expect(observer.onTurnCompleted).not.toHaveBeenCalled();
  });

  it('one observer throwing synchronously does NOT block subsequent observers and does NOT break streaming', async () => {
    const { session, listeners } = createMockSession();
    const mgr = createMockManager(session);
    session.send.mockImplementation(async () => {
      listeners.message.forEach((cb) => cb({ data: { messageId: 'm', content: 'pong' } }));
      listeners.idle.forEach((cb) => cb());
    });

    const order: string[] = [];
    const observerA: TurnCompletionObserver = {
      onTurnCompleted: () => { order.push('a'); throw new Error('observer A boom'); },
    };
    const observerB: TurnCompletionObserver = {
      onTurnCompleted: () => { order.push('b'); },
    };
    const observerC: TurnCompletionObserver = {
      onTurnCompleted: () => { order.push('c'); },
    };

    const consoleWarn = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const svc = new ChatService(
        mgr as unknown as MindManager,
        new TurnQueue(),
        dateTimeProvider,
      );
      svc.addObserver(observerA);
      svc.addObserver(observerB);
      svc.addObserver(observerC);

      const emit = vi.fn();
      // Whole streaming path must still resolve cleanly.
      await expect(svc.sendMessage('mind-1', 'ping', 'msg-1', emit)).resolves.toBeUndefined();

      expect(order).toEqual(['a', 'b', 'c']);
      expect(emit).toHaveBeenCalledWith({ type: 'done' });
      expect(emit).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    } finally {
      consoleWarn.mockRestore();
    }
  });

  it('an observer rejecting asynchronously is logged and does NOT surface back into the streaming path', async () => {
    const { session, listeners } = createMockSession();
    const mgr = createMockManager(session);
    session.send.mockImplementation(async () => {
      listeners.message.forEach((cb) => cb({ data: { messageId: 'm', content: 'pong' } }));
      listeners.idle.forEach((cb) => cb());
    });

    const observerA: TurnCompletionObserver = {
      onTurnCompleted: async () => { throw new Error('async boom'); },
    };
    const observerB = { onTurnCompleted: vi.fn() };

    const consoleWarn = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const svc = new ChatService(
        mgr as unknown as MindManager,
        new TurnQueue(),
        dateTimeProvider,
      );
      svc.addObserver(observerA);
      svc.addObserver(observerB);

      const emit = vi.fn();
      await expect(svc.sendMessage('mind-1', 'ping', 'msg-1', emit)).resolves.toBeUndefined();

      // observer B was still invoked despite A's async rejection.
      expect(observerB.onTurnCompleted).toHaveBeenCalledTimes(1);
      // Streaming path stayed clean — no error event leaked from the observer failure.
      expect(emit).toHaveBeenCalledWith({ type: 'done' });
      expect(emit).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));

      // Drain microtasks to give the .catch on the rejected observer promise
      // a chance to run before the test ends so we know it was attached
      // (otherwise vitest would surface an unhandled rejection).
      for (let i = 0; i < 5; i++) await Promise.resolve();
    } finally {
      consoleWarn.mockRestore();
    }
  });

  it('default observers list is empty — existing 3-arg constructor callers keep working unchanged', async () => {
    const { session, listeners } = createMockSession();
    const mgr = createMockManager(session);
    session.send.mockImplementation(async () => {
      listeners.idle.forEach((cb) => cb());
    });

    // Three-arg construction (no observers) is the legacy contract.
    const svc = new ChatService(
      mgr as unknown as MindManager,
      new TurnQueue(),
      dateTimeProvider,
    );

    const emit = vi.fn();
    await svc.sendMessage('mind-1', 'hi', 'msg-1', emit);

    expect(emit).toHaveBeenCalledWith({ type: 'done' });
  });
});
