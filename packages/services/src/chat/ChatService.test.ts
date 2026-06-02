import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChatService } from './ChatService';
import { TurnQueue } from './TurnQueue';
import { Logger } from '../logger';
import type { MindManager } from '../mind';

type AllEventsHandler = (event: unknown) => void;
type TypedHandler = (event: unknown) => void;

const allEventsHandlers: AllEventsHandler[] = [];
const typedHandlers = new Map<string, Set<TypedHandler>>();

function fireSdkEvent(event: { type: string; agentId?: string; data?: { toolCallId?: string; [k: string]: unknown } }): void {
  const typed = typedHandlers.get(event.type);
  if (typed) {
    for (const handler of [...typed]) handler(event);
  }
  for (const handler of [...allEventsHandlers]) handler(event);
}

function resetSessionMockToDefault(): void {
  allEventsHandlers.length = 0;
  typedHandlers.clear();
  mockSession.on.mockImplementation(
    (
      eventOrCb: string | ((...args: unknown[]) => void),
      cb?: (...args: unknown[]) => void,
    ): (() => void) => {
      if (typeof eventOrCb === 'function') {
        const handler = eventOrCb as AllEventsHandler;
        allEventsHandlers.push(handler);
        return () => {
          const idx = allEventsHandlers.indexOf(handler);
          if (idx >= 0) allEventsHandlers.splice(idx, 1);
        };
      }
      if (cb) {
        const handler = cb as TypedHandler;
        let set = typedHandlers.get(eventOrCb);
        if (!set) {
          set = new Set();
          typedHandlers.set(eventOrCb, set);
        }
        set.add(handler);
        return () => {
          set?.delete(handler);
        };
      }
      return () => undefined;
    },
  );
}

const mockSession = {
  send: vi.fn().mockResolvedValue(undefined),
  abort: vi.fn().mockResolvedValue(undefined),
  destroy: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(
    (
      eventOrCb: string | ((...args: unknown[]) => void),
      _cb?: (...args: unknown[]) => void,
    ): (() => void) => {
      // Default impl: legacy behavior (returns a no-op unsubscribe).
      // Tests that need typed-event firing call resetSessionMockToDefault().
      void _cb;
      if (typeof eventOrCb === 'function') return () => undefined;
      return vi.fn();
    },
  ),
};

const validModelClient = {
  modelsCache: {} as unknown,
  listModels: vi.fn(async () => [{ id: 'm1', name: 'Model 1', extra: true }]),
};

const mockMindManager = {
  getMind: vi.fn((mindId: string) => {
    if (mindId === 'valid-mind') {
      return { session: mockSession, client: validModelClient };
    }
    if (mindId === 'broken-models') {
      return { session: mockSession, client: { listModels: vi.fn(async () => { throw new Error('model discovery failed'); }) } };
    }
    if (mindId === 'drifted-models') {
      return { session: mockSession, client: { listModels: vi.fn(async () => [{ modelId: 'm1', displayName: 'Model 1' }]) } };
    }
    return undefined;
  }),
  recreateSession: vi.fn(),
  recoverActiveConversationSession: vi.fn(),
  startNewConversation: vi.fn(),
  markActiveConversationHasMessages: vi.fn(),
  listConversationHistory: vi.fn(() => []),
  resumeConversation: vi.fn(async () => ({ sessionId: 'session-1', messages: [], conversations: [] })),
  deleteConversation: vi.fn(async () => ({ sessionId: 'session-1', messages: [], conversations: [] })),
  renameConversation: vi.fn(() => []),
  setMindModel: vi.fn(async () => null),
};

describe('ChatService', () => {
  let svc: ChatService;
  let turnQueue: TurnQueue;

  beforeEach(() => {
    vi.clearAllMocks();
    allEventsHandlers.length = 0;
    typedHandlers.clear();
    validModelClient.modelsCache = {};
    turnQueue = new TurnQueue();
    svc = new ChatService(mockMindManager as unknown as MindManager, turnQueue, () => ({
      currentDateTime: '2026-05-05T15:37:12.065Z',
      timezone: 'America/New_York',
    }));
  });

  describe('sendMessage', () => {
    it('gets session from MindManager and calls send', async () => {
      // Mock session.on to fire session.idle immediately
      mockSession.on.mockImplementation((eventOrCb: string | ((...args: unknown[]) => void), cb?: (...args: unknown[]) => void) => {
        if (eventOrCb === 'session.idle' && cb) {
          setTimeout(() => cb(), 0);
        }
        return vi.fn();
      });

      const emit = vi.fn();
      await svc.sendMessage('valid-mind', 'hello', 'msg-1', emit);

      expect(mockMindManager.getMind).toHaveBeenCalledWith('valid-mind');
      expect(mockSession.send).toHaveBeenCalledWith({
        prompt: '<current_datetime>\n2026-05-05T15:37:12.065Z\n</current_datetime>\n<timezone>\nAmerica/New_York\n</timezone>\n\nhello',
      });
      expect(mockMindManager.markActiveConversationHasMessages).toHaveBeenCalledWith('valid-mind', 'hello');
      expect(emit).toHaveBeenCalledWith({ type: 'done' });
    });

    it('persists model selection before sending with the mind session', async () => {
      mockSession.on.mockImplementation((eventOrCb: string | ((...args: unknown[]) => void), cb?: (...args: unknown[]) => void) => {
        if (eventOrCb === 'session.idle' && cb) {
          setTimeout(() => cb(), 0);
        }
        return vi.fn();
      });
      const emit = vi.fn();
      await svc.sendMessage('valid-mind', 'hello', 'msg-1', emit, 'gpt-5.4');

      expect(mockMindManager.setMindModel).toHaveBeenCalledWith('valid-mind', 'gpt-5.4');
      expect(mockSession.send).toHaveBeenCalledWith(expect.objectContaining({
        prompt: expect.stringContaining('hello'),
      }));
    });

    it('throws for invalid mindId', async () => {
      const emit = vi.fn();
      await svc.sendMessage('nonexistent', 'hello', 'msg-1', emit);
      expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    });

    it('does not arm a wall-clock fallback timer; long turns wait indefinitely for the SDK or user cancel (#222)', async () => {
      vi.useFakeTimers();
      try {
        // session.send resolves but session.idle never fires.
        mockSession.on.mockImplementation(() => vi.fn());
        mockSession.send.mockResolvedValue(undefined);

        const emit = vi.fn();
        const pending = svc.sendMessage('valid-mind', 'hello', 'msg-1', emit);

        // Drain enough microtasks to push past turnQueue.enqueue, send,
        // Promise.race, and the inner finally that clears SEND_TIMEOUT_MS.
        for (let i = 0; i < 10; i += 1) await Promise.resolve();

        // Far past the prior 5-minute fallback. No timer must be armed for
        // the turn deadline; the only timer in flight should be the 30s
        // SEND_TIMEOUT_MS, which is already cleared by send resolving.
        expect(vi.getTimerCount()).toBe(0);

        await vi.advanceTimersByTimeAsync(60 * 60_000); // one hour
        expect(emit).not.toHaveBeenCalledWith({ type: 'done' });
        expect(emit).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'timeout' }));
        expect(emit).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));

        // User-pressed Stop: cancelMessage aborts the controller, the
        // turnDone abort listener resolves, and the turn unwinds cleanly.
        await svc.cancelMessage('valid-mind', 'msg-1');
        await pending;
      } finally {
        vi.useRealTimers();
      }
    });

    it('emits a clear error when the SDK chat event contract drifts', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      let deltaListener: ((event: unknown) => void) | undefined;

      mockSession.on.mockImplementation(
        (event: string | ((...args: unknown[]) => void), cb?: (...args: unknown[]) => void) => {
          if (event === 'assistant.message_delta' && cb) {
            deltaListener = cb as (event: unknown) => void;
          }
          return vi.fn();
        },
      );
      mockSession.send.mockImplementation(async () => {
        deltaListener?.({ data: { id: 'sdk-message-1', text: 'hello' } });
      });

      try {
        const emit = vi.fn();
        await svc.sendMessage('valid-mind', 'hello', 'msg-1', emit);

        expect(emit).toHaveBeenCalledWith({
          type: 'error',
          message: 'SDK contract mismatch for assistant.message_delta',
        });
        expect(emit).not.toHaveBeenCalledWith({ type: 'done' });
      } finally {
        consoleError.mockRestore();
        mockSession.send.mockResolvedValue(undefined);
      }
    });
  });

  describe('cancelMessage', () => {
    it('does not abort the session when no message is streaming', async () => {
      mockSession.on.mockReturnValue(vi.fn());
      await expect(svc.cancelMessage('valid-mind', 'msg-1')).resolves.toBe(false);
      expect(mockSession.abort).not.toHaveBeenCalled();
    });

    it('aborts the session for a mind with an active message', async () => {
      let resolveSend: (() => void) | undefined;
      mockSession.on.mockReturnValue(vi.fn());
      mockSession.send.mockImplementation(() => new Promise<void>((resolve) => {
        resolveSend = resolve;
      }));

      const pending = svc.sendMessage('valid-mind', 'hello', 'msg-1', vi.fn());
      try {
        await vi.waitFor(() => {
          expect(mockSession.send).toHaveBeenCalled();
        });

        await expect(svc.cancelMessage('valid-mind', 'msg-1')).resolves.toBe(true);
        expect(mockSession.abort).toHaveBeenCalled();
      } finally {
        resolveSend?.();
        mockSession.send.mockResolvedValue(undefined);
        await pending;
      }
    });

    it('ignores stale cancel requests for an older message on the same mind', async () => {
      let resolveSend: (() => void) | undefined;
      mockSession.on.mockReturnValue(vi.fn());
      mockSession.send.mockImplementation(() => new Promise<void>((resolve) => {
        resolveSend = resolve;
      }));

      const pending = svc.sendMessage('valid-mind', 'hello', 'current-msg', vi.fn());
      try {
        await vi.waitFor(() => {
          expect(mockSession.send).toHaveBeenCalled();
        });

        await expect(svc.cancelMessage('valid-mind', 'stale-msg')).resolves.toBe(false);
        expect(mockSession.abort).not.toHaveBeenCalled();

        await expect(svc.cancelMessage('valid-mind', 'current-msg')).resolves.toBe(true);
        expect(mockSession.abort).toHaveBeenCalledOnce();
      } finally {
        resolveSend?.();
        mockSession.send.mockResolvedValue(undefined);
        await pending;
      }
    });

    it('clears the streaming guard immediately when the user stops a wedged send', async () => {
      let resolveSend: (() => void) | undefined;
      mockSession.on.mockReturnValue(vi.fn());
      mockSession.send.mockImplementation(() => new Promise<void>((resolve) => {
        resolveSend = resolve;
      }));

      const pending = svc.sendMessage('valid-mind', 'hello', 'msg-1', vi.fn());
      try {
        await vi.waitFor(() => {
          expect(mockSession.send).toHaveBeenCalled();
        });

        await expect(svc.resumeConversation('valid-mind', 'session-1')).rejects.toThrow('Cannot switch conversations');

        await expect(svc.cancelMessage('valid-mind', 'msg-1')).resolves.toBe(true);

        await expect(svc.resumeConversation('valid-mind', 'session-1')).resolves.toEqual({
          sessionId: 'session-1',
          messages: [],
          conversations: [],
        });
      } finally {
        resolveSend?.();
        mockSession.send.mockResolvedValue(undefined);
        await pending;
      }
    });
  });

  describe('newConversation', () => {
    it('delegates to mindManager.startNewConversation', async () => {
      await svc.newConversation('valid-mind');
      expect(mockMindManager.startNewConversation).toHaveBeenCalledWith('valid-mind');
    });

    it('rejects conversation switches while a message is streaming', async () => {
      mockSession.on.mockImplementation((eventOrCb: string | ((...args: unknown[]) => void), cb?: (...args: unknown[]) => void) => {
        void eventOrCb;
        void cb;
        return vi.fn();
      });
      const send = svc.sendMessage('valid-mind', 'hello', 'msg-1', vi.fn());
      await Promise.resolve();

      await expect(svc.newConversation('valid-mind')).rejects.toThrow('Cannot switch conversations');

      await svc.cancelMessage('valid-mind', 'msg-1');
      await send;
    });
  });

  describe('deleteConversation', () => {
    it('delegates to mindManager.deleteConversation', async () => {
      const result = await svc.deleteConversation('valid-mind', 'session-1');

      expect(mockMindManager.deleteConversation).toHaveBeenCalledWith('valid-mind', 'session-1');
      expect(result).toEqual({ sessionId: 'session-1', messages: [], conversations: [] });
    });

    it('rejects deletes while a message is streaming', async () => {
      mockSession.on.mockImplementation((eventOrCb: string | ((...args: unknown[]) => void), cb?: (...args: unknown[]) => void) => {
        void eventOrCb;
        void cb;
        return vi.fn();
      });
      const send = svc.sendMessage('valid-mind', 'hello', 'msg-1', vi.fn());
      await Promise.resolve();

      await expect(svc.deleteConversation('valid-mind', 'session-1')).rejects.toThrow('Cannot switch conversations');

      await svc.cancelMessage('valid-mind', 'msg-1');
      await send;
    });
  });

  describe('listModels', () => {
    it('returns models from the minds client', async () => {
      const models = await svc.listModels('valid-mind');
      expect(models).toEqual([{ id: 'm1', name: 'Model 1' }]);
    });

    it('clears the SDK model cache before listing models', async () => {
      await svc.listModels('valid-mind');
      expect(validModelClient.modelsCache).toBeNull();
    });

    it('returns empty array for invalid mind', async () => {
      const models = await svc.listModels('nonexistent');
      expect(models).toEqual([]);
    });

    it('surfaces model discovery failures', async () => {
      await expect(svc.listModels('broken-models')).rejects.toThrow('model discovery failed');
    });

    it('surfaces SDK model-list contract drift', async () => {
      await expect(svc.listModels('drifted-models')).rejects.toThrow(
        'SDK contract mismatch for client.listModels',
      );
    });

    it('BVT-CL01: merges BYO models after SDK models when both present', async () => {
      const svcWithByo = new ChatService(
        mockMindManager as unknown as MindManager,
        turnQueue,
        () => ({ currentDateTime: '2026-05-08T12:00:00Z', timezone: 'UTC' }),
        async () => [{ id: 'gemma-4-26b', name: 'gemma-4-26b', provider: 'byo' as const }],
      );
      const models = await svcWithByo.listModels('valid-mind');
      expect(models).toEqual([
        { id: 'm1', name: 'Model 1' },
        { id: 'gemma-4-26b', name: 'gemma-4-26b', provider: 'byo' },
      ]);
    });

    it('BVT-CL02: keeps same-id SDK and BYO models distinct', async () => {
      const svcWithByo = new ChatService(
        mockMindManager as unknown as MindManager,
        turnQueue,
        () => ({ currentDateTime: '2026-05-08T12:00:00Z', timezone: 'UTC' }),
        async () => [{ id: 'm1', name: 'Different Name', provider: 'byo' as const }],
      );
      const models = await svcWithByo.listModels('valid-mind');
      expect(models).toEqual([
        { id: 'm1', name: 'Model 1' },
        { id: 'm1', name: 'Different Name', provider: 'byo' },
      ]);
    });

    it('BVT-CL03: returns BYO-only when SDK errors but BYO is present', async () => {
      const svcWithByo = new ChatService(
        mockMindManager as unknown as MindManager,
        turnQueue,
        () => ({ currentDateTime: '2026-05-08T12:00:00Z', timezone: 'UTC' }),
        async () => [{ id: 'gemma', name: 'gemma', provider: 'byo' as const }],
      );
      const models = await svcWithByo.listModels('broken-models');
      expect(models).toEqual([{ id: 'gemma', name: 'gemma', provider: 'byo' }]);
    });

    it('BVT-CL04: still throws SDK error when no BYO fallback', async () => {
      const svcWithByo = new ChatService(
        mockMindManager as unknown as MindManager,
        turnQueue,
        () => ({ currentDateTime: '2026-05-08T12:00:00Z', timezone: 'UTC' }),
        async () => [],
      );
      await expect(svcWithByo.listModels('broken-models')).rejects.toThrow('model discovery failed');
    });

    it('BVT-CL05: returns SDK models when BYO provider returns null', async () => {
      const svcWithByo = new ChatService(
        mockMindManager as unknown as MindManager,
        turnQueue,
        () => ({ currentDateTime: '2026-05-08T12:00:00Z', timezone: 'UTC' }),
        async () => null,
      );
      const models = await svcWithByo.listModels('valid-mind');
      expect(models).toEqual([{ id: 'm1', name: 'Model 1' }]);
    });
  });

  describe('stale session retry', () => {
    it('retries once with fresh session on stale error', async () => {
      // First session: send rejects with stale-session error
      mockSession.send.mockRejectedValueOnce(new Error('Session not found: abc-123'));
      mockSession.on.mockReturnValue(vi.fn());

      // Fresh session returned by stale-session recovery
      const freshSession = {
        send: vi.fn().mockResolvedValue(undefined),
        abort: vi.fn().mockResolvedValue(undefined),
        destroy: vi.fn().mockResolvedValue(undefined),
        on: vi.fn((event: string, cb?: (...args: unknown[]) => void) => {
          if (event === 'session.idle' && cb) setTimeout(() => cb(), 0);
          return vi.fn();
        }),
      };
      mockMindManager.recoverActiveConversationSession.mockResolvedValueOnce(freshSession);

      const emit = vi.fn();
      await svc.sendMessage('valid-mind', 'hello', 'msg-1', emit);

      expect(emit).toHaveBeenCalledWith({ type: 'reconnecting' });
      expect(mockMindManager.recoverActiveConversationSession).toHaveBeenCalledWith('valid-mind');
      expect(mockMindManager.markActiveConversationHasMessages).toHaveBeenCalledTimes(1);
      expect(mockMindManager.markActiveConversationHasMessages).toHaveBeenCalledWith('valid-mind', 'hello');
      expect(freshSession.send).toHaveBeenCalledWith({
        prompt: '<current_datetime>\n2026-05-05T15:37:12.065Z\n</current_datetime>\n<timezone>\nAmerica/New_York\n</timezone>\n\nhello',
      });
      expect(emit).toHaveBeenCalledWith({ type: 'done' });
    });

    it('does not loop — surfaces error when reattach also fails with stale error', async () => {
      mockSession.send.mockRejectedValueOnce(new Error('Session not found: abc-123'));
      mockSession.on.mockReturnValue(vi.fn());

      const freshSession = {
        send: vi.fn().mockRejectedValueOnce(new Error('Session not found: def-456')),
        abort: vi.fn().mockResolvedValue(undefined),
        destroy: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(() => vi.fn()),
      };
      mockMindManager.recoverActiveConversationSession.mockResolvedValueOnce(freshSession);

      const emit = vi.fn();
      await svc.sendMessage('valid-mind', 'hello', 'msg-1', emit);

      expect(emit).toHaveBeenCalledWith({ type: 'reconnecting' });
      expect(emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error' }),
      );
      // Recovery is attempted exactly once; we surface the error rather than chain endless retries.
      expect(mockMindManager.recoverActiveConversationSession).toHaveBeenCalledTimes(1);
      expect(freshSession.send).toHaveBeenCalledTimes(1);
    });

    it('does not retry on non-stale errors', async () => {
      mockSession.send.mockRejectedValueOnce(new Error('Network error'));
      mockSession.on.mockReturnValue(vi.fn());

      const emit = vi.fn();
      await svc.sendMessage('valid-mind', 'hello', 'msg-1', emit);

      expect(mockMindManager.recoverActiveConversationSession).not.toHaveBeenCalled();
      expect(emit).not.toHaveBeenCalledWith({ type: 'reconnecting' });
      expect(emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', message: 'Network error' }),
      );
    });

    it('does not retry stale-session recovery after the user cancels', async () => {
      mockSession.send.mockRejectedValueOnce(new Error('Session not found: abc-123'));
      mockSession.on.mockReturnValue(vi.fn());

      const freshSession = {
        send: vi.fn().mockResolvedValue(undefined),
        abort: vi.fn().mockResolvedValue(undefined),
        destroy: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(() => vi.fn()),
      };
      let resolveRecovery: ((session: typeof freshSession) => void) | undefined;
      mockMindManager.recoverActiveConversationSession.mockImplementationOnce(
        () => new Promise<typeof freshSession>((resolve) => {
          resolveRecovery = resolve;
        }),
      );

      const emit = vi.fn();
      const pending = svc.sendMessage('valid-mind', 'hello', 'msg-1', emit);

      await vi.waitFor(() => {
        expect(mockMindManager.recoverActiveConversationSession).toHaveBeenCalledWith('valid-mind');
      });
      await svc.cancelMessage('valid-mind', 'msg-1');
      resolveRecovery?.(freshSession);
      await pending;

      expect(emit).toHaveBeenCalledWith({ type: 'reconnecting' });
      expect(freshSession.send).not.toHaveBeenCalled();
      expect(emit).not.toHaveBeenCalledWith({ type: 'done' });
      expect(emit).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    });
  });

  describe('listener ordering (regression: v0.25.0)', () => {
    it('attaches session.idle listener BEFORE session.send is called', async () => {
      // Simulate the SDK firing session.idle synchronously during send().
      // If listeners are registered AFTER send resolves, this event is missed
      // and turnDone hangs until the 5-minute timer expires.
      let idleListener: (() => void) | undefined;

      mockSession.on.mockImplementation(
        (event: string | ((...args: unknown[]) => void), cb?: (...args: unknown[]) => void) => {
          if (event === 'session.idle' && cb) {
            idleListener = cb as () => void;
          }
          return vi.fn();
        },
      );

      mockSession.send.mockImplementation(async () => {
        // SDK behavior: session.idle fires inside send() before it resolves.
        // The listener MUST already be attached for this to be caught.
        if (!idleListener) {
          throw new Error(
            'REGRESSION: session.idle listener was not attached before session.send() — this causes 5-minute hangs',
          );
        }
        idleListener();
      });

      const emit = vi.fn();
      await svc.sendMessage('valid-mind', 'hello', 'msg-1', emit);

      expect(emit).toHaveBeenCalledWith({ type: 'done' });
    });

    it('treats hung session.send as a stale session (30s send timeout)', async () => {
      vi.useFakeTimers();
      try {
        // send() never resolves — simulates dead WebSocket / killed CLI.
        mockSession.send.mockImplementation(() => new Promise(() => { /* hang */ }));
        mockSession.on.mockReturnValue(vi.fn());

        // Recreate returns a fresh, working session for the retry path.
        const freshSession = {
          send: vi.fn().mockResolvedValue(undefined),
          abort: vi.fn().mockResolvedValue(undefined),
          destroy: vi.fn().mockResolvedValue(undefined),
          on: vi.fn((event: string, cb?: (...args: unknown[]) => void) => {
            if (event === 'session.idle' && cb) queueMicrotask(() => cb());
            return vi.fn();
          }),
        };
        mockMindManager.recoverActiveConversationSession.mockResolvedValueOnce(freshSession);

        const emit = vi.fn();
        const promise = svc.sendMessage('valid-mind', 'hello', 'msg-1', emit);

        // Trip the 30s send-timeout guard.
        await vi.advanceTimersByTimeAsync(30_000);
        await promise;

        expect(emit).toHaveBeenCalledWith({ type: 'reconnecting' });
        expect(mockMindManager.recoverActiveConversationSession).toHaveBeenCalledWith('valid-mind');
        expect(freshSession.send).toHaveBeenCalledWith({
          prompt: '<current_datetime>\n2026-05-05T15:37:12.065Z\n</current_datetime>\n<timezone>\nAmerica/New_York\n</timezone>\n\nhello',
        });
      } finally {
        vi.useRealTimers();
        // Restore default impl so subsequent tests aren't left with a hung send.
        mockSession.send.mockResolvedValue(undefined);
      }
    });
  });

  describe('TurnQueue integration', () => {
    it('routes sendMessage through TurnQueue', async () => {
      const enqueueSpy = vi.spyOn(turnQueue, 'enqueue');
      mockSession.on.mockImplementation((eventOrCb: string | ((...args: unknown[]) => void), cb?: (...args: unknown[]) => void) => {
        if (eventOrCb === 'session.idle' && cb) {
          setTimeout(() => cb(), 0);
        }
        return vi.fn();
      });
      const emit = vi.fn();
      await svc.sendMessage('valid-mind', 'hello', 'msg-1', emit);
      expect(enqueueSpy).toHaveBeenCalledWith('valid-mind', expect.any(Function));
    });

    it('concurrent sends to same mind are serialized', async () => {
      const order: string[] = [];
      const idleCallbacks: (() => void)[] = [];

      mockSession.on.mockImplementation((eventOrCb: string | ((...args: unknown[]) => void), cb?: (...args: unknown[]) => void) => {
        if (eventOrCb === 'session.idle' && cb) {
          idleCallbacks.push(cb);
        }
        return vi.fn();
      });

      mockSession.send.mockImplementation(async ({ prompt }: { prompt: string }) => {
        order.push(`send-${prompt}`);
      });

      const emit1 = vi.fn();
      const emit2 = vi.fn();
      const p1 = svc.sendMessage('valid-mind', 'first', 'msg-1', emit1);
      const p2 = svc.sendMessage('valid-mind', 'second', 'msg-2', emit2);

      // Let microtasks settle so first send starts
      await new Promise((r) => setTimeout(r, 10));
      expect(order).toHaveLength(1);
      expect(order[0]).toContain('\n\nfirst');

      // Complete first message
      idleCallbacks.shift()?.();
      await new Promise((r) => setTimeout(r, 10));

      // Now second should have started
      expect(order).toHaveLength(2);
      expect(order[1]).toContain('\n\nsecond');

      // Complete second message
      idleCallbacks.shift()?.();
      await Promise.all([p1, p2]);

      expect(emit1).toHaveBeenCalledWith({ type: 'done' });
      expect(emit2).toHaveBeenCalledWith({ type: 'done' });
    });
  });

  describe('lifecycle instrumentation (#299)', () => {
    beforeEach(() => {
      resetSessionMockToDefault();
      Logger.setLevel('debug');
    });

    afterEach(() => {
      Logger.resetLevel();
    });

    it('subscribes to the single-arg session.on handler to instrument every event', async () => {
      mockSession.send.mockImplementation(async () => {
        fireSdkEvent({ type: 'assistant.message_delta', data: { messageId: 'm1', deltaContent: 'hi' } });
        fireSdkEvent({ type: 'assistant.message_delta', data: { messageId: 'm1', deltaContent: ' there' } });
        fireSdkEvent({ type: 'session.idle' });
      });

      await svc.sendMessage('valid-mind', 'hello', 'msg-1', vi.fn());

      // Single-arg handler is registered alongside typed handlers.
      const singleArgCalls = mockSession.on.mock.calls.filter((args) => typeof args[0] === 'function');
      expect(singleArgCalls.length).toBeGreaterThanOrEqual(1);

      // And it unsubscribes on cleanup so a later turn starts from zero handlers.
      expect(allEventsHandlers).toHaveLength(0);
    });

    it('defensively completes after root assistant.turn_end when no tools or sub-agents remain', async () => {
      vi.useFakeTimers();
      try {
        mockSession.send.mockImplementation(async () => {
          fireSdkEvent({ type: 'assistant.message', data: { messageId: 'm1', content: 'final output' } });
          fireSdkEvent({ type: 'assistant.turn_end', data: { turnId: 't1' } });
        });

        const emit = vi.fn();
        const pending = svc.sendMessage('valid-mind', 'hello', 'msg-1', emit);
        await vi.advanceTimersByTimeAsync(1_000);
        await pending;

        expect(emit).toHaveBeenCalledWith({ type: 'message_final', sdkMessageId: 'm1', content: 'final output' });
        expect(emit).toHaveBeenCalledWith({ type: 'done' });
      } finally {
        vi.useRealTimers();
      }
    });

    it('waits for outstanding tools to finish after root assistant.turn_end before completing defensively', async () => {
      vi.useFakeTimers();
      try {
        mockSession.send.mockImplementation(async () => {
          fireSdkEvent({ type: 'tool.execution_start', data: { toolCallId: 't1', toolName: 'shell' } });
          fireSdkEvent({ type: 'assistant.turn_end', data: { turnId: 't1' } });
        });

        const emit = vi.fn();
        const pending = svc.sendMessage('valid-mind', 'hello', 'msg-1', emit);
        await vi.advanceTimersByTimeAsync(5_000);
        expect(emit).not.toHaveBeenCalledWith({ type: 'done' });

        fireSdkEvent({
          type: 'tool.execution_complete',
          data: { toolCallId: 't1', success: true, result: { content: 'tool output' } },
        });
        await vi.advanceTimersByTimeAsync(1_000);
        await pending;

        expect(emit).toHaveBeenCalledWith({ type: 'done' });
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not complete when a new root turn starts after tool completion', async () => {
      vi.useFakeTimers();
      try {
        mockSession.send.mockImplementation(async () => {
          fireSdkEvent({ type: 'assistant.message', data: { messageId: 'm1', content: 'I will use the tool.' } });
          fireSdkEvent({ type: 'tool.execution_start', data: { toolCallId: 't1', toolName: 'cron_create' } });
          fireSdkEvent({ type: 'tool.execution_complete', data: { toolCallId: 't1', success: true } });
          fireSdkEvent({ type: 'assistant.turn_end', data: { turnId: 't1' } });
          fireSdkEvent({ type: 'assistant.turn_start', data: { turnId: 't2' } });
        });

        const emit = vi.fn();
        const pending = svc.sendMessage('valid-mind', 'hello', 'msg-1', emit);
        await vi.advanceTimersByTimeAsync(5_000);
        expect(emit).not.toHaveBeenCalledWith({ type: 'done' });

        fireSdkEvent({ type: 'assistant.message', data: { messageId: 'm2', content: 'final output' } });
        fireSdkEvent({ type: 'assistant.turn_end', data: { turnId: 't2' } });
        await vi.advanceTimersByTimeAsync(1_000);
        await pending;

        expect(emit).toHaveBeenCalledWith({ type: 'message_final', sdkMessageId: 'm2', content: 'final output' });
        expect(emit).toHaveBeenCalledWith({ type: 'done' });
      } finally {
        vi.useRealTimers();
      }
    });

    it('delays defensive completion when more output arrives during turn-end quiescence', async () => {
      vi.useFakeTimers();
      try {
        mockSession.send.mockImplementation(async () => {
          fireSdkEvent({ type: 'assistant.turn_end', data: { turnId: 't1' } });
        });

        const emit = vi.fn();
        const pending = svc.sendMessage('valid-mind', 'hello', 'msg-1', emit);
        await vi.advanceTimersByTimeAsync(500);

        fireSdkEvent({ type: 'assistant.message', data: { messageId: 'm1', content: 'late final output' } });
        await vi.advanceTimersByTimeAsync(999);
        expect(emit).not.toHaveBeenCalledWith({ type: 'done' });

        await vi.advanceTimersByTimeAsync(1);
        await pending;

        expect(emit).toHaveBeenCalledWith({ type: 'message_final', sdkMessageId: 'm1', content: 'late final output' });
        expect(emit).toHaveBeenCalledWith({ type: 'done' });
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not complete from root assistant.turn_end while a permission request is pending', async () => {
      vi.useFakeTimers();
      try {
        mockSession.send.mockImplementation(async () => {
          fireSdkEvent({
            type: 'permission.requested',
            data: {
              requestId: 'perm-1',
              permissionRequest: {
                kind: 'shell',
                fullCommandText: 'echo hello',
              },
            },
          });
          fireSdkEvent({ type: 'assistant.turn_end', data: { turnId: 't-root' } });
        });

        const emit = vi.fn();
        const pending = svc.sendMessage('valid-mind', 'hello', 'msg-1', emit);
        await vi.advanceTimersByTimeAsync(5_000);
        expect(emit).not.toHaveBeenCalledWith({ type: 'done' });

        fireSdkEvent({
          type: 'permission.completed',
          data: {
            requestId: 'perm-1',
            result: { kind: 'approved' },
          },
        });
        await vi.advanceTimersByTimeAsync(1_000);
        await pending;

        expect(emit).toHaveBeenCalledWith({ type: 'done' });
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not complete from root assistant.turn_end while a sub-agent turn is active', async () => {
      vi.useFakeTimers();
      try {
        mockSession.send.mockImplementation(async () => {
          fireSdkEvent({ type: 'assistant.turn_start', agentId: 'sub-1', data: { turnId: 't-sub' } });
          fireSdkEvent({ type: 'assistant.turn_end', data: { turnId: 't-root' } });
        });

        const emit = vi.fn();
        const pending = svc.sendMessage('valid-mind', 'hello', 'msg-1', emit);
        await vi.advanceTimersByTimeAsync(5_000);
        expect(emit).not.toHaveBeenCalledWith({ type: 'done' });

        fireSdkEvent({ type: 'assistant.turn_end', agentId: 'sub-1', data: { turnId: 't-sub' } });
        await vi.advanceTimersByTimeAsync(1_000);
        await pending;

        expect(emit).toHaveBeenCalledWith({ type: 'done' });
      } finally {
        vi.useRealTimers();
      }
    });

    it('logs at debug (not info) for a normally completed turn so successful turns are not noisy', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      try {
        mockSession.send.mockImplementation(async () => {
          fireSdkEvent({ type: 'session.idle' });
        });

        await svc.sendMessage('valid-mind', 'hello', 'msg-1', vi.fn());

        const calls = logSpy.mock.calls.filter(([, label]) => label === 'chat.turn.lifecycle');
        // Exactly one summary log per turn.
        expect(calls).toHaveLength(1);
        // And the reason is "completed", not "aborted".
        expect((calls[0][2] as { reason: string }).reason).toBe('completed');
      } finally {
        logSpy.mockRestore();
      }
    });

    it('lifecycle summary tracks outstanding tool count via tool.execution_start / _complete pairs', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      try {
        mockSession.send.mockImplementation(async () => {
          fireSdkEvent({ type: 'tool.execution_start', data: { toolCallId: 't1', toolName: 'shell' } });
          fireSdkEvent({ type: 'tool.execution_start', data: { toolCallId: 't2', toolName: 'shell' } });
          fireSdkEvent({ type: 'tool.execution_complete', data: { toolCallId: 't1', success: true } });
          fireSdkEvent({ type: 'tool.execution_complete', data: { toolCallId: 't2', success: true } });
          fireSdkEvent({ type: 'session.idle' });
        });

        await svc.sendMessage('valid-mind', 'hello', 'msg-1', vi.fn());

        const summary = logSpy.mock.calls.find(([, label]) => label === 'chat.turn.lifecycle')?.[2] as {
          outstandingToolCount: number;
          entries: { type: string; outstandingToolCount: number }[];
        } | undefined;
        expect(summary).toBeDefined();
        expect(summary!.outstandingToolCount).toBe(0);
        const counts = summary!.entries.map((e) => e.outstandingToolCount);
        // start, start, complete, complete, idle
        expect(counts).toEqual([1, 2, 1, 0, 0]);
      } finally {
        logSpy.mockRestore();
      }
    });

    it('captures agentId in trace entries so sub-agent events are distinguishable from root events', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      try {
        mockSession.send.mockImplementation(async () => {
          fireSdkEvent({ type: 'assistant.turn_end', agentId: 'sub-1', data: { turnId: 't-sub' } });
          fireSdkEvent({ type: 'assistant.turn_end', data: { turnId: 't-root' } });
          fireSdkEvent({ type: 'session.idle' });
        });

        await svc.sendMessage('valid-mind', 'hello', 'msg-1', vi.fn());

        const summary = logSpy.mock.calls.find(([, label]) => label === 'chat.turn.lifecycle')?.[2] as {
          entries: { type: string; agentId?: string }[];
        } | undefined;
        expect(summary).toBeDefined();
        const subAgentTurnEnd = summary!.entries.find((e) => e.type === 'assistant.turn_end' && e.agentId === 'sub-1');
        const rootTurnEnd = summary!.entries.find((e) => e.type === 'assistant.turn_end' && e.agentId === undefined);
        expect(subAgentTurnEnd).toBeDefined();
        expect(rootTurnEnd).toBeDefined();
      } finally {
        logSpy.mockRestore();
      }
    });

    it('sub-agent assistant.turn_end alone does NOT trip the info-level #299 fingerprint on user abort', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      try {
        mockSession.send.mockImplementation(async () => {
          // Only sub-agent turn_end fires. Sub-agent turn_end is common in
          // multi-agent / delegated work and is NOT terminal — a user-pressed
          // Stop here must not be classified as the #299 fingerprint.
          fireSdkEvent({ type: 'assistant.turn_end', agentId: 'sub-1', data: { turnId: 't-sub' } });
        });

        const pending = svc.sendMessage('valid-mind', 'hello', 'msg-1', vi.fn());
        await new Promise((r) => setTimeout(r, 10));
        await svc.cancelMessage('valid-mind', 'msg-1');
        await pending;

        const calls = logSpy.mock.calls.filter(([, label]) => label === 'chat.turn.lifecycle');
        expect(calls).toHaveLength(1);
        const summary = calls[0][2] as { reason: string; sawTurnEnd: boolean; sawRootTurnEnd: boolean };
        expect(summary.reason).toBe('aborted');
        expect(summary.sawTurnEnd).toBe(true);
        expect(summary.sawRootTurnEnd).toBe(false);
      } finally {
        logSpy.mockRestore();
      }
    });

    it('classifies terminal reason as "threw" when session.send rejects with a non-stale error (instrumentation must not lie)', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      try {
        mockSession.send.mockRejectedValueOnce(new Error('Network down'));

        await svc.sendMessage('valid-mind', 'hello', 'msg-1', vi.fn());

        const calls = logSpy.mock.calls.filter(([, label]) => label === 'chat.turn.lifecycle');
        expect(calls).toHaveLength(1);
        expect((calls[0][2] as { reason: string }).reason).toBe('threw');
      } finally {
        logSpy.mockRestore();
      }
    });

    it('classifies terminal reason as "sdk_error" when session.error fires', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      try {
        mockSession.send.mockImplementation(async () => {
          fireSdkEvent({ type: 'session.error', data: { message: 'SDK exploded' } });
        });

        await svc.sendMessage('valid-mind', 'hello', 'msg-1', vi.fn());

        const calls = logSpy.mock.calls.filter(([, label]) => label === 'chat.turn.lifecycle');
        expect(calls).toHaveLength(1);
        expect((calls[0][2] as { reason: string }).reason).toBe('sdk_error');
      } finally {
        logSpy.mockRestore();
      }
    });

    it('unsubscribes the trace listener before finally logs, so events fired after idle do not inflate the summary', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      try {
        mockSession.send.mockImplementation(async () => {
          fireSdkEvent({ type: 'session.idle' });
        });

        await svc.sendMessage('valid-mind', 'hello', 'msg-1', vi.fn());

        const summaryBefore = logSpy.mock.calls.find(([, label]) => label === 'chat.turn.lifecycle')?.[2] as {
          eventCount: number;
        };
        expect(summaryBefore.eventCount).toBe(1);

        // After teardown, no all-events handlers should remain registered.
        expect(allEventsHandlers).toHaveLength(0);
        // Firing a stray event after the turn ends must not surface anywhere
        // (no error, no additional log) because the trace is no longer alive.
        fireSdkEvent({ type: 'session.idle' });
        const callsAfter = logSpy.mock.calls.filter(([, label]) => label === 'chat.turn.lifecycle');
        expect(callsAfter).toHaveLength(1);
      } finally {
        logSpy.mockRestore();
      }
    });

    it('classifies terminal reason as "sdk_contract" when session.error payload fails Zod parsing', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        mockSession.send.mockImplementation(async () => {
          // Malformed session.error payload — `data.message` must be a string;
          // a numeric here trips the Zod schema in `getSdkSessionErrorMessage`
          // and routes us through `failSdkContract` → abort with
          // `sdkContractFailed = true`. The abort listener must reclassify
          // `terminalReason` from the default 'aborted' to 'sdk_contract'.
          fireSdkEvent({ type: 'session.error', data: { message: 12345 } });
        });

        await svc.sendMessage('valid-mind', 'hello', 'msg-1', vi.fn());

        const calls = logSpy.mock.calls.filter(([, label]) => label === 'chat.turn.lifecycle');
        expect(calls).toHaveLength(1);
        expect((calls[0][2] as { reason: string }).reason).toBe('sdk_contract');
      } finally {
        logSpy.mockRestore();
        errSpy.mockRestore();
      }
    });

    it('captures outstandingToolCount > 0 at the #299 fingerprint moment (the disambiguator for "still working" vs "really stuck")', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      try {
        mockSession.send.mockImplementation(async () => {
          // Tool started but never completes; root turn_end fires; no idle.
          // User gives up → abort. The summary at the fingerprint moment must
          // report outstandingToolCount = 1 so triagers can distinguish
          // "user gave up while a tool was still working" from "SDK was
          // truly wedged with nothing in flight".
          fireSdkEvent({ type: 'tool.execution_start', data: { toolCallId: 't-slow', toolName: 'shell' } });
          fireSdkEvent({ type: 'assistant.turn_end', data: { turnId: 't1' } });
        });

        const pending = svc.sendMessage('valid-mind', 'hello', 'msg-1', vi.fn());
        await new Promise((r) => setTimeout(r, 10));
        await svc.cancelMessage('valid-mind', 'msg-1');
        await pending;

        const calls = logSpy.mock.calls.filter(([, label]) => label === 'chat.turn.lifecycle');
        expect(calls).toHaveLength(1);
        const summary = calls[0][2] as {
          reason: string;
          sawRootTurnEnd: boolean;
          sawIdle: boolean;
          outstandingToolCount: number;
        };
        expect(summary.reason).toBe('aborted');
        expect(summary.sawRootTurnEnd).toBe(true);
        expect(summary.sawIdle).toBe(false);
        expect(summary.outstandingToolCount).toBe(1);
      } finally {
        logSpy.mockRestore();
      }
    });
  });
});

describe('mapByoLlmError', () => {
  it('BVT-CE01: rewrites llama.cpp n_keep / n_ctx errors with actionable hint', async () => {
    const { mapByoLlmError } = await import('./ChatService');
    const original = '400 "The number of tokens to keep from the initial prompt is greater than the context length (n_keep: 83159>= n_ctx: 4096). Try to load the model with a larger context length, or provide a shorter input."';
    const out = mapByoLlmError(original);
    expect(out).toContain('larger-context model');
    expect(out).toContain('qwen3.5-9b');
    expect(out).toContain(original);  // original error preserved at the end
  });

  it('BVT-CE02: passes through non-context errors unchanged', async () => {
    const { mapByoLlmError } = await import('./ChatService');
    const original = 'Connection refused: ECONNREFUSED 127.0.0.1:8080';
    expect(mapByoLlmError(original)).toBe(original);
  });
});
