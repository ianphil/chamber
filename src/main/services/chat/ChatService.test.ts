import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatService } from './ChatService';

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

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new ChatService(mockMindManager as any);
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
});
