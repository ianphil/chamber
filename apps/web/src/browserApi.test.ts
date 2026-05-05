/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MindContext } from '@chamber/shared/types';

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
  static acknowledgeSubscriptions = true;
  readyState = MockWebSocket.OPEN;

  constructor(url: URL) {
    super();
    void url;
    queueMicrotask(() => this.dispatchEvent(new Event('open')));
  }

  send(data: string): void {
    const message = JSON.parse(data) as { type?: string; sessionId?: string };
    if (MockWebSocket.acknowledgeSubscriptions && message.type === 'subscribe' && message.sessionId) {
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
    MockWebSocket.acknowledgeSubscriptions = true;
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

  it('cancels chat with the requested mind id', async () => {
    await window.electronAPI.chat.stop('dude-1234', 'assistant-1');
    expect(cancelChat).toHaveBeenCalledWith('dude-1234', 'assistant-1');
  });

  it('rejects chat send when the event subscription is not acknowledged', async () => {
    vi.useFakeTimers();
    try {
      MockWebSocket.acknowledgeSubscriptions = false;

      const sendPromise = window.electronAPI.chat.send('dude-1234', 'Hello', 'assistant-1');
      const rejection = expect(sendPromise).rejects.toThrow('Timed out waiting for Chamber event subscription.');
      await vi.advanceTimersByTimeAsync(10_000);
      await rejection;
      expect(sendChat).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects browser-mode write APIs that cannot be executed without the desktop shell', async () => {
    await expect(window.electronAPI.mind.remove('dude-1234')).rejects.toThrow(
      'Not available in browser mode',
    );
    await expect(window.electronAPI.mind.setActive('dude-1234')).rejects.toThrow(
      'Not available in browser mode',
    );
    await expect(window.electronAPI.lens.sendAction('view-1', 'save')).rejects.toThrow(
      'Not available in browser mode',
    );
    await expect(window.electronAPI.chatroom.send('hello')).rejects.toThrow(
      'Not available in browser mode',
    );
    await expect(window.electronAPI.chatroom.clear()).rejects.toThrow(
      'Not available in browser mode',
    );
    await expect(window.electronAPI.chatroom.stop()).rejects.toThrow(
      'Not available in browser mode',
    );
    await expect(window.electronAPI.chatroom.setOrchestration('concurrent')).rejects.toThrow(
      'Not available in browser mode',
    );
  });

  it('throws explicit unavailable errors for browser window controls', () => {
    expect(() => window.electronAPI.window.minimize()).toThrow('Not available in browser mode');
    expect(() => window.electronAPI.window.maximize()).toThrow('Not available in browser mode');
  });

  it('keeps browser-mode subscription APIs as no-op unsubscribe functions', () => {
    const unsubscribes = [
      window.electronAPI.mind.onMindChanged(() => undefined),
      window.electronAPI.lens.onViewsChanged(() => undefined),
      window.electronAPI.genesis.onProgress(() => undefined),
      window.electronAPI.a2a.onIncoming(() => undefined),
      window.electronAPI.a2a.onTaskStatusUpdate(() => undefined),
      window.electronAPI.a2a.onTaskArtifactUpdate(() => undefined),
      window.electronAPI.chatroom.onEvent(() => undefined),
    ];

    for (const unsubscribe of unsubscribes) {
      expect(typeof unsubscribe).toBe('function');
      expect(unsubscribe()).toBeUndefined();
    }
  });
});
