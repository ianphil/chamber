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
    setOrchestration: ReturnType<typeof vi.fn>;
    listSessions: ReturnType<typeof vi.fn>;
    createSession: ReturnType<typeof vi.fn>;
    resumeSession: ReturnType<typeof vi.fn>;
    renameSession: ReturnType<typeof vi.fn>;
    deleteSession: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    const emitter = new EventEmitter();
    mockService = Object.assign(emitter, {
      broadcast: vi.fn().mockResolvedValue(undefined),
      getHistory: vi.fn().mockReturnValue([]),
      clearHistory: vi.fn().mockResolvedValue(undefined),
      stopAll: vi.fn(),
      setOrchestration: vi.fn(),
      listSessions: vi.fn().mockReturnValue([]),
      createSession: vi.fn().mockReturnValue({ sessionId: 'cr-new', title: 'New chatroom', createdAt: '', updatedAt: '', active: false, hasMessages: false }),
      resumeSession: vi.fn().mockReturnValue({
        session: { sessionId: 'cr-1', title: 'A', createdAt: '', updatedAt: '', active: true, hasMessages: false },
        messages: [],
        taskLedger: [],
      }),
      renameSession: vi.fn().mockReturnValue([]),
      deleteSession: vi.fn().mockReturnValue([]),
    });
    setupChatroomIPC(mockService as unknown as ChatroomService);
  });

  it('chatroom:send invokes broadcast with message and model', async () => {
    const handler = getHandler('chatroom:send');
    await handler(EVT, 'Hello agents', 'gpt-4');
    expect(mockService.broadcast).toHaveBeenCalledWith('Hello agents', undefined, 'gpt-4');
  });

  it('chatroom:send works without model', async () => {
    const handler = getHandler('chatroom:send');
    await handler(EVT, 'Hello agents');
    expect(mockService.broadcast).toHaveBeenCalledWith('Hello agents', undefined, undefined);
  });

  it('chatroom:send forwards renderer-supplied roundId to the service', async () => {
    const handler = getHandler('chatroom:send');
    await handler(EVT, 'Hello agents', 'gpt-4', 'renderer-round-1');
    expect(mockService.broadcast).toHaveBeenCalledWith('Hello agents', 'renderer-round-1', 'gpt-4');
  });

  it('chatroom:send accepts roundId without a model', async () => {
    const handler = getHandler('chatroom:send');
    await handler(EVT, 'Hello agents', undefined, 'renderer-round-2');
    expect(mockService.broadcast).toHaveBeenCalledWith('Hello agents', 'renderer-round-2', undefined);
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
      expect(mockService.broadcast).toHaveBeenCalledWith('hello', exact, undefined);
    });
    it('TypeError message names the channel and the bad field by name', async () => {
      const handler = getHandler('chatroom:send');
      await expect(handler(EVT, '')).rejects.toThrow(/chatroom:send/);
      await expect(handler(EVT, '')).rejects.toThrow(/message/);
      await expect(handler(EVT, 'hello', 7)).rejects.toThrow(/model/);
      await expect(handler(EVT, 'hello', undefined, '')).rejects.toThrow(/roundId/);
    });
  });

  describe('chatroom:set-orchestration input validation', () => {
    it('accepts concurrent mode without config', async () => {
      const handler = getHandler('chatroom:set-orchestration');
      await handler(EVT, 'concurrent');
      expect(mockService.setOrchestration).toHaveBeenCalledWith('concurrent', undefined);
    });

    it('accepts sequential mode without config', async () => {
      const handler = getHandler('chatroom:set-orchestration');
      await handler(EVT, 'sequential');
      expect(mockService.setOrchestration).toHaveBeenCalledWith('sequential', undefined);
    });

    it('accepts group-chat mode without config (renderer fires this on first mode switch)', async () => {
      const handler = getHandler('chatroom:set-orchestration');
      await handler(EVT, 'group-chat');
      expect(mockService.setOrchestration).toHaveBeenCalledWith('group-chat', undefined);
    });

    it('accepts handoff mode without config (renderer fires this on first mode switch)', async () => {
      const handler = getHandler('chatroom:set-orchestration');
      await handler(EVT, 'handoff');
      expect(mockService.setOrchestration).toHaveBeenCalledWith('handoff', undefined);
    });

    it('accepts magentic mode without config (renderer fires this on first mode switch)', async () => {
      const handler = getHandler('chatroom:set-orchestration');
      await handler(EVT, 'magentic');
      expect(mockService.setOrchestration).toHaveBeenCalledWith('magentic', undefined);
    });

    it('accepts group-chat mode with a valid config', async () => {
      const handler = getHandler('chatroom:set-orchestration');
      const config = { moderatorMindId: 'mod-1', maxTurns: 10, minRounds: 1, maxSpeakerRepeats: 3 };
      await handler(EVT, 'group-chat', config);
      expect(mockService.setOrchestration).toHaveBeenCalledWith('group-chat', config);
    });

    it('accepts handoff mode with a valid config (no initialMindId)', async () => {
      const handler = getHandler('chatroom:set-orchestration');
      const config = { maxHandoffHops: 5 };
      await handler(EVT, 'handoff', config);
      expect(mockService.setOrchestration).toHaveBeenCalledWith('handoff', config);
    });

    it('accepts handoff mode with a valid config (with initialMindId)', async () => {
      const handler = getHandler('chatroom:set-orchestration');
      const config = { initialMindId: 'agent-a', maxHandoffHops: 5 };
      await handler(EVT, 'handoff', config);
      expect(mockService.setOrchestration).toHaveBeenCalledWith('handoff', config);
    });

    it('accepts magentic mode with a valid config (no allowedMindIds)', async () => {
      const handler = getHandler('chatroom:set-orchestration');
      const config = { managerMindId: 'mgr-1', maxSteps: 10 };
      await handler(EVT, 'magentic', config);
      expect(mockService.setOrchestration).toHaveBeenCalledWith('magentic', config);
    });

    it('accepts magentic mode with a valid config (with allowedMindIds)', async () => {
      const handler = getHandler('chatroom:set-orchestration');
      const config = { managerMindId: 'mgr-1', maxSteps: 10, allowedMindIds: ['a', 'b'] };
      await handler(EVT, 'magentic', config);
      expect(mockService.setOrchestration).toHaveBeenCalledWith('magentic', config);
    });

    it('rejects unknown mode without invoking the service', async () => {
      const handler = getHandler('chatroom:set-orchestration');
      await expect(handler(EVT, 'broadcast')).rejects.toThrow(TypeError);
      expect(mockService.setOrchestration).not.toHaveBeenCalled();
    });

    it('rejects non-string mode without invoking the service', async () => {
      const handler = getHandler('chatroom:set-orchestration');
      await expect(handler(EVT, 42)).rejects.toThrow(TypeError);
      expect(mockService.setOrchestration).not.toHaveBeenCalled();
    });

    it('rejects concurrent mode with any non-undefined config (object)', async () => {
      const handler = getHandler('chatroom:set-orchestration');
      await expect(handler(EVT, 'concurrent', {})).rejects.toThrow(TypeError);
      expect(mockService.setOrchestration).not.toHaveBeenCalled();
    });

    it('rejects concurrent mode with null config', async () => {
      const handler = getHandler('chatroom:set-orchestration');
      await expect(handler(EVT, 'concurrent', null)).rejects.toThrow(TypeError);
      expect(mockService.setOrchestration).not.toHaveBeenCalled();
    });

    it('rejects sequential mode with any non-undefined config', async () => {
      const handler = getHandler('chatroom:set-orchestration');
      await expect(handler(EVT, 'sequential', { maxTurns: 5 })).rejects.toThrow(TypeError);
      expect(mockService.setOrchestration).not.toHaveBeenCalled();
    });

    it('rejects group-chat mode with null config', async () => {
      const handler = getHandler('chatroom:set-orchestration');
      await expect(handler(EVT, 'group-chat', null)).rejects.toThrow(TypeError);
      expect(mockService.setOrchestration).not.toHaveBeenCalled();
    });

    it('rejects group-chat mode when config is the wrong type entirely', async () => {
      const handler = getHandler('chatroom:set-orchestration');
      await expect(handler(EVT, 'group-chat', 42)).rejects.toThrow(TypeError);
      expect(mockService.setOrchestration).not.toHaveBeenCalled();
    });

    it('rejects group-chat mode missing required fields', async () => {
      const handler = getHandler('chatroom:set-orchestration');
      await expect(handler(EVT, 'group-chat', { moderatorMindId: 'mod-1' })).rejects.toThrow(TypeError);
      expect(mockService.setOrchestration).not.toHaveBeenCalled();
    });

    it('rejects group-chat mode with empty moderatorMindId', async () => {
      const handler = getHandler('chatroom:set-orchestration');
      await expect(handler(EVT, 'group-chat', {
        moderatorMindId: '',
        maxTurns: 10,
        minRounds: 1,
        maxSpeakerRepeats: 3,
      })).rejects.toThrow(TypeError);
      expect(mockService.setOrchestration).not.toHaveBeenCalled();
    });

    it('rejects group-chat mode with non-positive maxTurns', async () => {
      const handler = getHandler('chatroom:set-orchestration');
      await expect(handler(EVT, 'group-chat', {
        moderatorMindId: 'mod-1',
        maxTurns: 0,
        minRounds: 1,
        maxSpeakerRepeats: 3,
      })).rejects.toThrow(TypeError);
      expect(mockService.setOrchestration).not.toHaveBeenCalled();
    });

    it('rejects group-chat mode with extra fields', async () => {
      const handler = getHandler('chatroom:set-orchestration');
      await expect(handler(EVT, 'group-chat', {
        moderatorMindId: 'mod-1',
        maxTurns: 10,
        minRounds: 1,
        maxSpeakerRepeats: 3,
        extra: 'nope',
      })).rejects.toThrow(TypeError);
      expect(mockService.setOrchestration).not.toHaveBeenCalled();
    });

    it('rejects handoff mode missing maxHandoffHops', async () => {
      const handler = getHandler('chatroom:set-orchestration');
      await expect(handler(EVT, 'handoff', { initialMindId: 'a' })).rejects.toThrow(TypeError);
      expect(mockService.setOrchestration).not.toHaveBeenCalled();
    });

    it('rejects handoff mode with zero maxHandoffHops', async () => {
      const handler = getHandler('chatroom:set-orchestration');
      await expect(handler(EVT, 'handoff', { maxHandoffHops: 0 })).rejects.toThrow(TypeError);
      expect(mockService.setOrchestration).not.toHaveBeenCalled();
    });

    it('rejects handoff mode with non-integer maxHandoffHops', async () => {
      const handler = getHandler('chatroom:set-orchestration');
      await expect(handler(EVT, 'handoff', { maxHandoffHops: 1.5 })).rejects.toThrow(TypeError);
      expect(mockService.setOrchestration).not.toHaveBeenCalled();
    });

    it('rejects magentic mode missing managerMindId', async () => {
      const handler = getHandler('chatroom:set-orchestration');
      await expect(handler(EVT, 'magentic', { maxSteps: 10 })).rejects.toThrow(TypeError);
      expect(mockService.setOrchestration).not.toHaveBeenCalled();
    });

    it('rejects magentic mode with zero maxSteps', async () => {
      const handler = getHandler('chatroom:set-orchestration');
      await expect(handler(EVT, 'magentic', { managerMindId: 'mgr-1', maxSteps: 0 })).rejects.toThrow(TypeError);
      expect(mockService.setOrchestration).not.toHaveBeenCalled();
    });

    it('rejects magentic mode with empty-string entry in allowedMindIds', async () => {
      const handler = getHandler('chatroom:set-orchestration');
      await expect(handler(EVT, 'magentic', {
        managerMindId: 'mgr-1',
        maxSteps: 10,
        allowedMindIds: ['a', ''],
      })).rejects.toThrow(TypeError);
      expect(mockService.setOrchestration).not.toHaveBeenCalled();
    });

    it('TypeError message names the channel for an unknown mode', async () => {
      const handler = getHandler('chatroom:set-orchestration');
      await expect(handler(EVT, 'broadcast')).rejects.toThrow(/chatroom:set-orchestration/);
    });

    it('TypeError message names the bad field for a malformed group-chat config', async () => {
      const handler = getHandler('chatroom:set-orchestration');
      await expect(handler(EVT, 'group-chat', { moderatorMindId: '', maxTurns: 10, minRounds: 1, maxSpeakerRepeats: 3 }))
        .rejects.toThrow(/moderatorMindId/);
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

  describe('session adapters', () => {
    it('chatroom:list-sessions delegates to listSessions', async () => {
      const summary = [{ sessionId: 'cr-1', title: 'A', createdAt: '', updatedAt: '', active: true, hasMessages: false }];
      mockService.listSessions.mockReturnValue(summary);

      const result = await getHandler('chatroom:list-sessions')(EVT);

      expect(mockService.listSessions).toHaveBeenCalled();
      expect(result).toBe(summary);
    });

    it('chatroom:create-session passes through a string title', async () => {
      await getHandler('chatroom:create-session')(EVT, 'New room');
      expect(mockService.createSession).toHaveBeenCalledWith('New room');
    });

    it('chatroom:create-session normalizes non-string titles to undefined', async () => {
      await getHandler('chatroom:create-session')(EVT, 42);
      expect(mockService.createSession).toHaveBeenCalledWith(undefined);
    });

    it('chatroom:resume-session rejects when sessionId is missing or non-string', async () => {
      await expect(getHandler('chatroom:resume-session')(EVT)).rejects.toThrow(/sessionId/);
      await expect(getHandler('chatroom:resume-session')(EVT, 7)).rejects.toThrow(/sessionId/);
      await expect(getHandler('chatroom:resume-session')(EVT, '')).rejects.toThrow(/sessionId/);
      expect(mockService.resumeSession).not.toHaveBeenCalled();
    });

    it('chatroom:resume-session returns the service payload for a valid id', async () => {
      const payload = {
        session: { sessionId: 'cr-2', title: 'Two', createdAt: '', updatedAt: '', active: true, hasMessages: false },
        messages: [],
        taskLedger: [],
      };
      mockService.resumeSession.mockReturnValue(payload);

      const result = await getHandler('chatroom:resume-session')(EVT, 'cr-2');

      expect(mockService.resumeSession).toHaveBeenCalledWith('cr-2');
      expect(result).toBe(payload);
    });

    it('chatroom:rename-session rejects when either argument is invalid', async () => {
      await expect(getHandler('chatroom:rename-session')(EVT)).rejects.toThrow(/sessionId/);
      await expect(getHandler('chatroom:rename-session')(EVT, 'cr-1')).rejects.toThrow(/title/);
      await expect(getHandler('chatroom:rename-session')(EVT, 'cr-1', 7)).rejects.toThrow(/title/);
      expect(mockService.renameSession).not.toHaveBeenCalled();
    });

    it('chatroom:rename-session passes both arguments to the service', async () => {
      await getHandler('chatroom:rename-session')(EVT, 'cr-1', 'Renamed');
      expect(mockService.renameSession).toHaveBeenCalledWith('cr-1', 'Renamed');
    });

    it('chatroom:delete-session rejects when sessionId is missing or non-string', async () => {
      await expect(getHandler('chatroom:delete-session')(EVT)).rejects.toThrow(/sessionId/);
      await expect(getHandler('chatroom:delete-session')(EVT, 0)).rejects.toThrow(/sessionId/);
      expect(mockService.deleteSession).not.toHaveBeenCalled();
    });

    it('chatroom:delete-session forwards the id to the service', async () => {
      await getHandler('chatroom:delete-session')(EVT, 'cr-1');
      expect(mockService.deleteSession).toHaveBeenCalledWith('cr-1');
    });
  });
});
