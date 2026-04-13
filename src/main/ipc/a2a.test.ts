import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
}));

import { ipcMain, BrowserWindow } from 'electron';
import { setupA2AIPC } from './a2a';

const mockRegistry = {
  getCards: vi.fn(() => [
    { mindId: 'agent-a', name: 'Agent A' },
    { mindId: 'agent-b', name: 'Agent B' },
  ]),
};

describe('A2A IPC', () => {
  let ipcEmitter: EventEmitter;

  beforeEach(() => {
    vi.clearAllMocks();
    ipcEmitter = new EventEmitter();
    setupA2AIPC(ipcEmitter, mockRegistry as any);
  });

  it('a2a:incoming forwards to all windows', () => {
    const mockWebContents1 = { send: vi.fn() };
    const mockWebContents2 = { send: vi.fn() };
    (BrowserWindow.getAllWindows as any).mockReturnValue([
      { webContents: mockWebContents1 },
      { webContents: mockWebContents2 },
    ]);

    const payload = {
      targetMindId: 'agent-b',
      message: { messageId: 'msg-1', role: 'user', parts: [{ text: 'Hello' }] },
      replyMessageId: 'reply-1',
    };
    ipcEmitter.emit('a2a:incoming', payload);

    expect(mockWebContents1.send).toHaveBeenCalledWith('a2a:incoming', payload);
    expect(mockWebContents2.send).toHaveBeenCalledWith('a2a:incoming', payload);
  });

  it('a2a:incoming payload includes message and replyMessageId', () => {
    const mockWebContents = { send: vi.fn() };
    (BrowserWindow.getAllWindows as any).mockReturnValue([{ webContents: mockWebContents }]);

    const payload = {
      targetMindId: 'agent-b',
      message: { messageId: 'msg-1', role: 'user', parts: [{ text: 'Test' }], metadata: { fromId: 'agent-a', fromName: 'Agent A' } },
      replyMessageId: 'reply-msg-1',
    };
    ipcEmitter.emit('a2a:incoming', payload);

    const sent = mockWebContents.send.mock.calls[0];
    expect(sent[0]).toBe('a2a:incoming');
    expect(sent[1]).toHaveProperty('message');
    expect(sent[1]).toHaveProperty('replyMessageId', 'reply-msg-1');
    expect(sent[1]).toHaveProperty('targetMindId', 'agent-b');
  });

  it('a2a:listAgents returns cards from registry', async () => {
    const handleCalls = (ipcMain.handle as any).mock.calls;
    const listHandler = handleCalls.find((c: any) => c[0] === 'a2a:listAgents');
    expect(listHandler).toBeDefined();

    const result = await listHandler[1]({});
    expect(result).toEqual([
      { mindId: 'agent-a', name: 'Agent A' },
      { mindId: 'agent-b', name: 'Agent B' },
    ]);
    expect(mockRegistry.getCards).toHaveBeenCalled();
  });
});
