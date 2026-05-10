import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
}));

import { ipcMain, BrowserWindow } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { setupA2AIPC } from './a2a';
import type { AgentCardRegistry, TaskArtifactUpdateEvent, TaskManager, TaskStatusUpdateEvent } from '@chamber/services';

// Helper to keep test ergonomics — the IPC handler signature demands
// IpcMainInvokeEvent / BrowserWindow instances we don't need in unit tests.
const EVT = {} as IpcMainInvokeEvent;
const asWindows = (wins: { webContents: { send: unknown } }[]): Electron.BrowserWindow[] =>
  wins as unknown as Electron.BrowserWindow[];
type InvokeHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;
const getHandler = (name: string): InvokeHandler => {
  const call = vi.mocked(ipcMain.handle).mock.calls.find((c) => c[0] === name);
  if (!call) throw new Error(`no handler registered for ${name}`);
  return call[1] as InvokeHandler;
};

const mockRegistry = {
  getCards: vi.fn(() => [
    { mindId: 'agent-a', name: 'Agent A' },
    { mindId: 'agent-b', name: 'Agent B' },
  ]),
};

const mockTaskManager = {
  getTask: vi.fn(),
  listTasks: vi.fn(),
  cancelTask: vi.fn(),
};

describe('A2A IPC', () => {
  let ipcEmitter: EventEmitter;

  beforeEach(() => {
    vi.clearAllMocks();
    ipcEmitter = new EventEmitter();
    setupA2AIPC(ipcEmitter, mockRegistry as unknown as AgentCardRegistry, mockTaskManager as unknown as TaskManager);
  });

  it('a2a:incoming forwards to all windows', () => {
    const mockWebContents1 = { send: vi.fn() };
    const mockWebContents2 = { send: vi.fn() };
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue(asWindows([
      { webContents: mockWebContents1 },
      { webContents: mockWebContents2 },
    ]));

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
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue(asWindows([{ webContents: mockWebContents }]));

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

  it('e2e:a2a:incoming emits incoming payload only when E2E mode is enabled', async () => {
    const previous = process.env.CHAMBER_E2E;
    process.env.CHAMBER_E2E = '1';
    vi.clearAllMocks();
    ipcEmitter = new EventEmitter();
    setupA2AIPC(ipcEmitter, mockRegistry as unknown as AgentCardRegistry, mockTaskManager as unknown as TaskManager);

    const payload = {
      targetMindId: 'agent-b',
      message: { messageId: 'msg-1', role: 'user' as const, parts: [{ text: 'Test' }], metadata: { fromId: 'agent-a', fromName: 'Agent A' } },
      replyMessageId: 'reply-msg-1',
    };
    const incoming = new Promise((resolve) => {
      ipcEmitter.once('a2a:incoming', resolve);
    });

    try {
      await getHandler('e2e:a2a:incoming')(EVT, payload);
      await expect(incoming).resolves.toEqual(payload);
    } finally {
      if (previous === undefined) {
        delete process.env.CHAMBER_E2E;
      } else {
        process.env.CHAMBER_E2E = previous;
      }
    }
  });

  it('a2a:listAgents returns cards from registry', async () => {
    const result = await getHandler('a2a:listAgents')(EVT);
    expect(result).toEqual([
      { mindId: 'agent-a', name: 'Agent A' },
      { mindId: 'agent-b', name: 'Agent B' },
    ]);
    expect(mockRegistry.getCards).toHaveBeenCalled();
  });

  // --- Task IPC tests ---

  it('task:status-update event forwarded to all BrowserWindows', () => {
    const wc1 = { send: vi.fn() };
    const wc2 = { send: vi.fn() };
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue(asWindows([
      { webContents: wc1 },
      { webContents: wc2 },
    ]));

    const payload: TaskStatusUpdateEvent = {
      taskId: 'task-1',
      contextId: 'ctx-1',
      status: { state: 'working' },
    };
    ipcEmitter.emit('task:status-update', payload);

    expect(wc1.send).toHaveBeenCalledWith('a2a:task-status-update', payload);
    expect(wc2.send).toHaveBeenCalledWith('a2a:task-status-update', payload);
  });

  it('task:artifact-update event forwarded to all BrowserWindows', () => {
    const wc1 = { send: vi.fn() };
    const wc2 = { send: vi.fn() };
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue(asWindows([
      { webContents: wc1 },
      { webContents: wc2 },
    ]));

    const payload: TaskArtifactUpdateEvent = {
      taskId: 'task-1',
      contextId: 'ctx-1',
      artifact: { artifactId: 'art-1', parts: [{ text: 'result' }] },
      lastChunk: true,
    };
    ipcEmitter.emit('task:artifact-update', payload);

    expect(wc1.send).toHaveBeenCalledWith('a2a:task-artifact-update', payload);
    expect(wc2.send).toHaveBeenCalledWith('a2a:task-artifact-update', payload);
  });

  it('a2a:getTask handle returns task from TaskManager', async () => {
    const task = { id: 'task-1', contextId: 'ctx-1', status: { state: 'completed' } };
    mockTaskManager.getTask.mockReturnValue(task);

    const result = await getHandler('a2a:getTask')(EVT, 'task-1', 5);
    expect(mockTaskManager.getTask).toHaveBeenCalledWith('task-1', 5);
    expect(result).toEqual(task);
  });

  it('a2a:listTasks handle returns task list from TaskManager', async () => {
    const response = { tasks: [], nextPageToken: '', pageSize: 0, totalSize: 0 };
    mockTaskManager.listTasks.mockReturnValue(response);

    const filter = { contextId: 'ctx-1', status: 'working' };
    const result = await getHandler('a2a:listTasks')(EVT, filter);
    expect(mockTaskManager.listTasks).toHaveBeenCalledWith(filter);
    expect(result).toEqual(response);
  });

  it('a2a:listTasks drops invalid status values at the IPC boundary', async () => {
    const response = { tasks: [], nextPageToken: '', pageSize: 0, totalSize: 0 };
    mockTaskManager.listTasks.mockReturnValue(response);

    await getHandler('a2a:listTasks')(EVT, { contextId: 'ctx-1', status: 'bogus-status' });
    expect(mockTaskManager.listTasks).toHaveBeenCalledWith({ contextId: 'ctx-1', status: undefined });
  });

  it('a2a:cancelTask handle returns updated task', async () => {
    const task = { id: 'task-1', contextId: 'ctx-1', status: { state: 'canceled' } };
    mockTaskManager.cancelTask.mockReturnValue(task);

    const result = await getHandler('a2a:cancelTask')(EVT, 'task-1');
    expect(mockTaskManager.cancelTask).toHaveBeenCalledWith('task-1');
    expect(result).toEqual(task);
  });

  it('a2a:cancelTask rejects when TaskManager throws', async () => {
    mockTaskManager.cancelTask.mockImplementation(() => {
      throw new Error('Task task-1 not found');
    });

    await expect(getHandler('a2a:cancelTask')(EVT, 'task-1')).rejects.toThrow('Task task-1 not found');
  });
});
