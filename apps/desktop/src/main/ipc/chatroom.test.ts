import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
}));

import { ipcMain, BrowserWindow } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { setupChatroomIPC } from './chatroom';
import type { ChatroomService } from '@chamber/services';

const EVT = {} as IpcMainInvokeEvent;
const asWindows = (wins: unknown[]): Electron.BrowserWindow[] => wins as unknown as Electron.BrowserWindow[];
type InvokeHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

function getHandler(channel: string): InvokeHandler {
  const calls = vi.mocked(ipcMain.handle).mock.calls;
  const match = calls.find((c) => c[0] === channel);
  if (!match) throw new Error(`No handler registered for ${channel}`);
  return match[1] as InvokeHandler;
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
    setupChatroomIPC(mockService as unknown as ChatroomService);
  });

  it('chatroom:send invokes broadcast with message and model', async () => {
    const handler = getHandler('chatroom:send');
    await handler(EVT, 'Hello agents', 'gpt-4');
    expect(mockService.broadcast).toHaveBeenCalledWith('Hello agents', 'gpt-4', undefined);
  });

  it('chatroom:send works without model', async () => {
    const handler = getHandler('chatroom:send');
    await handler(EVT, 'Hello agents');
    expect(mockService.broadcast).toHaveBeenCalledWith('Hello agents', undefined, undefined);
  });

  it('chatroom:send forwards renderer-supplied roundId to the service', async () => {
    const handler = getHandler('chatroom:send');
    await handler(EVT, 'Hello agents', 'gpt-4', 'renderer-round-1');
    expect(mockService.broadcast).toHaveBeenCalledWith('Hello agents', 'gpt-4', 'renderer-round-1');
  });

  it('chatroom:send accepts roundId without a model', async () => {
    const handler = getHandler('chatroom:send');
    await handler(EVT, 'Hello agents', undefined, 'renderer-round-2');
    expect(mockService.broadcast).toHaveBeenCalledWith('Hello agents', undefined, 'renderer-round-2');
  });

  describe('chatroom:send input validation', () => {
    const invalidMessages: Array<[string, unknown]> = [
      ['number', 42],
      ['null', null],
      ['undefined', undefined],
      ['object', { text: 'hi' }],
      ['array', ['hi']],
      ['boolean', true],
    ];

    for (const [label, value] of invalidMessages) {
      it(`rejects ${label} message without invoking broadcast`, async () => {
        const handler = getHandler('chatroom:send');
        await expect(handler(EVT, value)).rejects.toThrow(TypeError);
        expect(mockService.broadcast).not.toHaveBeenCalled();
      });
    }

    it('rejects empty-string message without invoking broadcast', async () => {
      const handler = getHandler('chatroom:send');
      await expect(handler(EVT, '')).rejects.toThrow(TypeError);
      expect(mockService.broadcast).not.toHaveBeenCalled();
    });

    const invalidModels: Array<[string, unknown]> = [
      ['number', 7],
      ['null', null],
      ['object', {}],
    ];

    for (const [label, value] of invalidModels) {
      it(`rejects ${label} model without invoking broadcast`, async () => {
        const handler = getHandler('chatroom:send');
        await expect(handler(EVT, 'hello', value)).rejects.toThrow(TypeError);
        expect(mockService.broadcast).not.toHaveBeenCalled();
      });
    }

    it('accepts undefined model', async () => {
      const handler = getHandler('chatroom:send');
      await handler(EVT, 'hello', undefined);
      expect(mockService.broadcast).toHaveBeenCalledWith('hello', undefined, undefined);
    });

    const invalidRoundIds: Array<[string, unknown]> = [
      ['number', 9],
      ['null', null],
      ['object', { id: 'r' }],
      ['empty string', ''],
    ];

    for (const [label, value] of invalidRoundIds) {
      it(`rejects ${label} roundId without invoking broadcast`, async () => {
        const handler = getHandler('chatroom:send');
        await expect(handler(EVT, 'hello', undefined, value)).rejects.toThrow(TypeError);
        expect(mockService.broadcast).not.toHaveBeenCalled();
      });
    }

    it('rejects roundId longer than 128 characters', async () => {
      const handler = getHandler('chatroom:send');
      const tooLong = 'x'.repeat(129);
      await expect(handler(EVT, 'hello', undefined, tooLong)).rejects.toThrow(TypeError);
      expect(mockService.broadcast).not.toHaveBeenCalled();
    });

    it('accepts roundId exactly 128 characters', async () => {
      const handler = getHandler('chatroom:send');
      const exact = 'x'.repeat(128);
      await handler(EVT, 'hello', undefined, exact);
      expect(mockService.broadcast).toHaveBeenCalledWith('hello', undefined, exact);
    });
  });

  it('chatroom:history returns result from getHistory', async () => {
    const messages = [{ id: 'msg-1', role: 'user', blocks: [], timestamp: 1 }];
    mockService.getHistory.mockReturnValue(messages);

    const handler = getHandler('chatroom:history');
    const result = await handler(EVT);
    expect(result).toEqual(messages);
    expect(mockService.getHistory).toHaveBeenCalled();
  });

  it('chatroom:clear calls clearHistory', async () => {
    const handler = getHandler('chatroom:clear');
    await handler(EVT);
    expect(mockService.clearHistory).toHaveBeenCalled();
  });

  it('chatroom:stop calls stopAll', async () => {
    const handler = getHandler('chatroom:stop');
    await handler(EVT);
    expect(mockService.stopAll).toHaveBeenCalled();
  });

  it('chatroom:event forwarding sends to all windows', () => {
    const wc1 = { send: vi.fn() };
    const wc2 = { send: vi.fn() };
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue(asWindows([
      { isDestroyed: () => false, webContents: wc1 },
      { isDestroyed: () => false, webContents: wc2 },
    ]));

    const event = { mindId: 'agent-a', mindName: 'Agent A', messageId: 'msg-1', roundId: 'r-1', event: { type: 'chunk', content: 'hi' } };
    mockService.emit('chatroom:event', event);

    expect(wc1.send).toHaveBeenCalledWith('chatroom:event', event);
    expect(wc2.send).toHaveBeenCalledWith('chatroom:event', event);
  });

  it('chatroom:event skips destroyed windows', () => {
    const wc1 = { send: vi.fn() };
    const wc2 = { send: vi.fn() };
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue(asWindows([
      { isDestroyed: () => true, webContents: wc1 },
      { isDestroyed: () => false, webContents: wc2 },
    ]));

    const event = { mindId: 'agent-a', mindName: 'Agent A', messageId: 'msg-1', roundId: 'r-1', event: { type: 'done' } };
    mockService.emit('chatroom:event', event);

    expect(wc1.send).not.toHaveBeenCalled();
    expect(wc2.send).toHaveBeenCalledWith('chatroom:event', event);
  });
});
