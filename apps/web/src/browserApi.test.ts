/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MindContext } from './shared/types';

const addMind = vi.fn();
const sendChat = vi.fn();
const cancelChat = vi.fn();
const listMinds = vi.fn();
const listModels = vi.fn();
const startNewConversation = vi.fn();

vi.mock('@chamber/client', () => ({
  ChamberClient: vi.fn(function ChamberClient() {
    return {
    addMind,
    sendChat,
    cancelChat,
    listMinds,
    listModels,
    startNewConversation,
    };
  }),
}));

class MockWebSocket extends EventTarget {
  static readonly OPEN = 1;
  readyState = MockWebSocket.OPEN;

  constructor(url: URL) {
    super();
    void url;
    queueMicrotask(() => this.dispatchEvent(new Event('open')));
  }

  send(data: string): void {
    const message = JSON.parse(data) as { type?: string; sessionId?: string };
    if (message.type === 'subscribe' && message.sessionId) {
      queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', {
        data: JSON.stringify({ type: 'subscription:ready', payload: { sessionId: message.sessionId } }),
      })));
    }
  }
}

describe('installBrowserApi', () => {
  const mind: MindContext = {
    mindId: 'dude-1234',
    mindPath: 'C:\\agents\\dude',
    identity: { name: 'Dude', systemMessage: '' },
    status: 'ready',
  };

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    addMind.mockResolvedValue(mind);
    sendChat.mockResolvedValue({ ok: true });
    cancelChat.mockResolvedValue({ ok: true });
    listMinds.mockResolvedValue([mind]);
    listModels.mockResolvedValue([{ id: 'claude-sonnet', name: 'Claude Sonnet' }]);
    startNewConversation.mockResolvedValue({ ok: true });
    vi.stubGlobal('WebSocket', MockWebSocket);
    Reflect.deleteProperty(window, 'electronAPI');
    const { installBrowserApi } = await import('./browserApi');
    installBrowserApi();
  });

  it('loads local minds through the loopback client', async () => {
    await expect(window.electronAPI.mind.add('C:\\agents\\dude')).resolves.toBe(mind);
    expect(addMind).toHaveBeenCalledWith('C:\\agents\\dude');
  });

  it('sends chat through the loopback client', async () => {
    await window.electronAPI.chat.send('dude-1234', 'Hello', 'assistant-1', 'claude-sonnet');
    expect(sendChat).toHaveBeenCalledWith({
      mindId: 'dude-1234',
      message: 'Hello',
      messageId: 'assistant-1',
      model: 'claude-sonnet',
      attachments: undefined,
    });
  });
});
