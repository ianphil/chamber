import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatService } from './ChatService';
import { TurnQueue } from './TurnQueue';
import type { MindManager } from '../mind';

const mockSession = {
  send: vi.fn().mockResolvedValue(undefined),
  abort: vi.fn().mockResolvedValue(undefined),
  destroy: vi.fn().mockResolvedValue(undefined),
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  on: vi.fn((_event: string, _cb?: (...args: unknown[]) => void) => vi.fn()),
};

const validModelClient = {
  modelsCache: {} as unknown,
  listModels: vi.fn(async () => [{ id: 'm1', name: 'Model 1' }]),
};

const mockMindManager = {
  getMind: vi.fn((mindId: string) => {
    if (mindId === 'valid-mind') {
      return { session: mockSession, client: validModelClient };
    }
    if (mindId === 'broken-models') {
      return { session: mockSession, client: { listModels: vi.fn(async () => { throw new Error('model discovery failed'); }) } };
    }
    return undefined;
  }),
  recreateSession: vi.fn(),
  setMindModel: vi.fn(async () => null),
};

describe('ChatService', () => {
  let svc: ChatService;
  let turnQueue: TurnQueue;

  beforeEach(() => {
    vi.clearAllMocks();
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
    it('aborts the session for a mind', async () => {
      mockSession.on.mockReturnValue(vi.fn());
      await svc.cancelMessage('valid-mind', 'msg-1');
      expect(mockSession.abort).toHaveBeenCalled();
    });
  });

  describe('newConversation', () => {
    it('delegates to mindManager.recreateSession', async () => {
      await svc.newConversation('valid-mind');
      expect(mockMindManager.recreateSession).toHaveBeenCalledWith('valid-mind');
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
  });

  describe('stale session retry', () => {
    it('retries once with fresh session on stale error', async () => {
      // First session: send rejects with stale-session error
      mockSession.send.mockRejectedValueOnce(new Error('Session not found: abc-123'));
      mockSession.on.mockReturnValue(vi.fn());

      // Fresh session returned by recreateSession
      const freshSession = {
        send: vi.fn().mockResolvedValue(undefined),
        abort: vi.fn().mockResolvedValue(undefined),
        destroy: vi.fn().mockResolvedValue(undefined),
        on: vi.fn((event: string, cb?: (...args: unknown[]) => void) => {
          if (event === 'session.idle' && cb) setTimeout(() => cb(), 0);
          return vi.fn();
        }),
      };
      mockMindManager.recreateSession.mockResolvedValueOnce(freshSession);

      const emit = vi.fn();
      await svc.sendMessage('valid-mind', 'hello', 'msg-1', emit);

      expect(emit).toHaveBeenCalledWith({ type: 'reconnecting' });
      expect(mockMindManager.recreateSession).toHaveBeenCalledWith('valid-mind');
      expect(freshSession.send).toHaveBeenCalledWith({
        prompt: '<current_datetime>\n2026-05-05T15:37:12.065Z\n</current_datetime>\n<timezone>\nAmerica/New_York\n</timezone>\n\nhello',
      });
      expect(emit).toHaveBeenCalledWith({ type: 'done' });
    });

    it('does not loop — surfaces error when retry also fails with stale error', async () => {
      mockSession.send.mockRejectedValueOnce(new Error('Session not found: abc-123'));
      mockSession.on.mockReturnValue(vi.fn());

      const freshSession = {
        send: vi.fn().mockRejectedValueOnce(new Error('Session not found: def-456')),
        abort: vi.fn().mockResolvedValue(undefined),
        destroy: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(() => vi.fn()),
      };
      mockMindManager.recreateSession.mockResolvedValueOnce(freshSession);

      const emit = vi.fn();
      await svc.sendMessage('valid-mind', 'hello', 'msg-1', emit);

      expect(emit).toHaveBeenCalledWith({ type: 'reconnecting' });
      expect(emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error' }),
      );
      // recreateSession called only once — no second retry
      expect(mockMindManager.recreateSession).toHaveBeenCalledTimes(1);
    });

    it('does not retry on non-stale errors', async () => {
      mockSession.send.mockRejectedValueOnce(new Error('Network error'));
      mockSession.on.mockReturnValue(vi.fn());

      const emit = vi.fn();
      await svc.sendMessage('valid-mind', 'hello', 'msg-1', emit);

      expect(mockMindManager.recreateSession).not.toHaveBeenCalled();
      expect(emit).not.toHaveBeenCalledWith({ type: 'reconnecting' });
      expect(emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', message: 'Network error' }),
      );
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
        mockMindManager.recreateSession.mockResolvedValueOnce(freshSession);

        const emit = vi.fn();
        const promise = svc.sendMessage('valid-mind', 'hello', 'msg-1', emit);

        // Trip the 30s send-timeout guard.
        await vi.advanceTimersByTimeAsync(30_000);
        await promise;

        expect(emit).toHaveBeenCalledWith({ type: 'reconnecting' });
        expect(mockMindManager.recreateSession).toHaveBeenCalledWith('valid-mind');
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
});
