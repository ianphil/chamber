import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatService } from './ChatService';
import { TurnQueue } from './TurnQueue';

const mockSession = {
  send: vi.fn(async () => {}),
  abort: vi.fn(async () => {}),
  destroy: vi.fn(async () => {}),
  on: vi.fn((_eventOrCb: any, _cb?: any) => vi.fn()),
};

const mockMindManager = {
  getMind: vi.fn((mindId: string) => {
    if (mindId === 'valid-mind') {
      return { session: mockSession, client: { listModels: vi.fn(async () => [{ id: 'm1', name: 'Model 1' }]) } };
    }
    return undefined;
  }),
  recreateSession: vi.fn(async () => {}),
};

describe('ChatService', () => {
  let svc: ChatService;
  let turnQueue: TurnQueue;

  beforeEach(() => {
    vi.clearAllMocks();
    turnQueue = new TurnQueue();
    svc = new ChatService(mockMindManager as any, turnQueue);
  });

  describe('sendMessage', () => {
    it('gets session from MindManager and calls send', async () => {
      // Mock session.on to fire session.idle immediately
      mockSession.on.mockImplementation((eventOrCb: any, cb?: any) => {
        if (eventOrCb === 'session.idle' && cb) {
          setTimeout(() => cb(), 0);
        }
        return vi.fn();
      });

      const emit = vi.fn();
      await svc.sendMessage('valid-mind', 'hello', 'msg-1', emit);

      expect(mockMindManager.getMind).toHaveBeenCalledWith('valid-mind');
      expect(mockSession.send).toHaveBeenCalledWith({ prompt: 'hello' });
      expect(emit).toHaveBeenCalledWith({ type: 'done' });
    });

    it('throws for invalid mindId', async () => {
      const emit = vi.fn();
      await svc.sendMessage('nonexistent', 'hello', 'msg-1', emit);
      expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
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

    it('returns empty array for invalid mind', async () => {
      const models = await svc.listModels('nonexistent');
      expect(models).toEqual([]);
    });
  });

  describe('TurnQueue integration', () => {
    it('routes sendMessage through TurnQueue', async () => {
      const enqueueSpy = vi.spyOn(turnQueue, 'enqueue');
      mockSession.on.mockImplementation((eventOrCb: any, cb?: any) => {
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
      let idleCallbacks: (() => void)[] = [];

      mockSession.on.mockImplementation((eventOrCb: any, cb?: any) => {
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
      expect(order).toEqual(['send-first']);

      // Complete first message
      idleCallbacks.shift()?.();
      await new Promise((r) => setTimeout(r, 10));

      // Now second should have started
      expect(order).toEqual(['send-first', 'send-second']);

      // Complete second message
      idleCallbacks.shift()?.();
      await Promise.all([p1, p2]);

      expect(emit1).toHaveBeenCalledWith({ type: 'done' });
      expect(emit2).toHaveBeenCalledWith({ type: 'done' });
    });
  });
});
