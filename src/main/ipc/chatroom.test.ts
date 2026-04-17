import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: {
    fromWebContents: vi.fn(),
    getAllWindows: vi.fn(() => []),
  },
}));

import { ipcMain, BrowserWindow } from 'electron';
import { setupChatroomIPC } from './chatroom';
import type { ChatroomService } from '../services/chatroom/ChatroomService';
import { Dispatcher } from '../rpc/dispatcher';
import { PushBus } from '../rpc/pushBus';
import { installIpcPushSink } from './pushSink';

function getHandler(channel: string): (...args: unknown[]) => unknown {
  const calls = vi.mocked(ipcMain.handle).mock.calls;
  const match = calls.find((c) => c[0] === channel);
  if (!match) throw new Error(`No handler registered for ${channel}`);
  return match[1] as (...args: unknown[]) => unknown;
}

describe('Chatroom IPC', () => {
  let mockService: EventEmitter & {
    broadcast: ReturnType<typeof vi.fn>;
    getHistory: ReturnType<typeof vi.fn>;
    clearHistory: ReturnType<typeof vi.fn>;
    stopAll: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    const emitter = new EventEmitter();
    mockService = Object.assign(emitter, {
      broadcast: vi.fn().mockResolvedValue(undefined),
      getHistory: vi.fn().mockReturnValue([]),
      clearHistory: vi.fn().mockResolvedValue(undefined),
      stopAll: vi.fn(),
    });
    const dispatcher = new Dispatcher();
    const pushBus = new PushBus();
    installIpcPushSink(pushBus);
    setupChatroomIPC(dispatcher, pushBus, mockService as unknown as ChatroomService);
  });

  it('chatroom:send invokes broadcast with message and model', async () => {
    await getHandler('chatroom:send')({ sender: {} }, 'Hello agents', 'gpt-4');
    expect(mockService.broadcast).toHaveBeenCalledWith('Hello agents', 'gpt-4');
  });

  it('chatroom:send works without model', async () => {
    await getHandler('chatroom:send')({ sender: {} }, 'Hello agents');
    expect(mockService.broadcast).toHaveBeenCalledWith('Hello agents', undefined);
  });

  it('chatroom:history returns result from getHistory', async () => {
    const messages = [{ id: 'msg-1', role: 'user', blocks: [], timestamp: 1 }];
    mockService.getHistory.mockReturnValue(messages);
    const result = await getHandler('chatroom:history')({ sender: {} });
    expect(result).toEqual(messages);
    expect(mockService.getHistory).toHaveBeenCalled();
  });

  it('chatroom:clear calls clearHistory', async () => {
    await getHandler('chatroom:clear')({ sender: {} });
    expect(mockService.clearHistory).toHaveBeenCalled();
  });

  it('chatroom:stop calls stopAll', async () => {
    await getHandler('chatroom:stop')({ sender: {} });
    expect(mockService.stopAll).toHaveBeenCalled();
  });

  it('chatroom:send rejects empty message with IpcValidationError', async () => {
    const { IpcValidationError } = await import('../../contracts/errors');
    await expect(getHandler('chatroom:send')({ sender: {} }, '')).rejects.toBeInstanceOf(
      IpcValidationError,
    );
    expect(mockService.broadcast).not.toHaveBeenCalled();
  });

  it('chatroom:clear rejects extra args', async () => {
    const { IpcValidationError } = await import('../../contracts/errors');
    await expect(
      getHandler('chatroom:clear')({ sender: {} }, 'unexpected'),
    ).rejects.toBeInstanceOf(IpcValidationError);
    expect(mockService.clearHistory).not.toHaveBeenCalled();
  });

  it('chatroom:event forwarding sends to all windows', () => {
    const wc1 = { send: vi.fn() };
    const wc2 = { send: vi.fn() };
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      { isDestroyed: () => false, webContents: wc1 },
      { isDestroyed: () => false, webContents: wc2 },
    ] as never);

    const event = {
      mindId: 'agent-a',
      mindName: 'Agent A',
      messageId: 'msg-1',
      roundId: 'r-1',
      event: { type: 'chunk', content: 'hi' },
    };
    mockService.emit('chatroom:event', event);

    expect(wc1.send).toHaveBeenCalledWith('chatroom:event', event);
    expect(wc2.send).toHaveBeenCalledWith('chatroom:event', event);
  });

  it('chatroom:event skips destroyed windows', () => {
    const wc1 = { send: vi.fn() };
    const wc2 = { send: vi.fn() };
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      { isDestroyed: () => true, webContents: wc1 },
      { isDestroyed: () => false, webContents: wc2 },
    ] as never);

    const event = {
      mindId: 'agent-a',
      mindName: 'Agent A',
      messageId: 'msg-1',
      roundId: 'r-1',
      event: { type: 'done' },
    };
    mockService.emit('chatroom:event', event);

    expect(wc1.send).not.toHaveBeenCalled();
    expect(wc2.send).toHaveBeenCalledWith('chatroom:event', event);
  });
});
