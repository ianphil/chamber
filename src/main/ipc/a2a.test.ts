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
import { setupA2AIPC } from './a2a';
import type { TaskStatusUpdateEvent, TaskArtifactUpdateEvent } from '../services/a2a/types';
import type { AgentCardRegistry } from '../services/a2a/AgentCardRegistry';
import type { TaskManager } from '../services/a2a/TaskManager';
import { Dispatcher } from '../rpc/dispatcher';
import { PushBus } from '../rpc/pushBus';
import { installIpcPushSink } from './pushSink';

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

function getHandler(channel: string) {
  const call = vi.mocked(ipcMain.handle).mock.calls.find((c) => c[0] === channel);
  if (!call) throw new Error(`handler not registered: ${channel}`);
  return call[1] as (event: unknown, ...args: unknown[]) => Promise<unknown>;
}

describe('A2A IPC', () => {
  let ipcEmitter: EventEmitter;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([] as never);
    ipcEmitter = new EventEmitter();
    const dispatcher = new Dispatcher();
    const pushBus = new PushBus();
    installIpcPushSink(pushBus);
    setupA2AIPC(
      dispatcher,
      pushBus,
      ipcEmitter,
      mockRegistry as unknown as AgentCardRegistry,
      mockTaskManager as unknown as TaskManager,
    );
  });

  it('a2a:incoming forwards to all windows', () => {
    const wc1 = { send: vi.fn() };
    const wc2 = { send: vi.fn() };
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      { isDestroyed: () => false, webContents: wc1 },
      { isDestroyed: () => false, webContents: wc2 },
    ] as never);

    const payload = {
      targetMindId: 'agent-b',
      message: { messageId: 'msg-1', role: 'user', parts: [{ text: 'Hello' }] },
      replyMessageId: 'reply-1',
    };
    ipcEmitter.emit('a2a:incoming', payload);

    expect(wc1.send).toHaveBeenCalledWith('a2a:incoming', payload);
    expect(wc2.send).toHaveBeenCalledWith('a2a:incoming', payload);
  });

  it('a2a:listAgents returns cards from registry', async () => {
    const result = await getHandler('a2a:listAgents')({ sender: {} });
    expect(result).toEqual([
      { mindId: 'agent-a', name: 'Agent A' },
      { mindId: 'agent-b', name: 'Agent B' },
    ]);
    expect(mockRegistry.getCards).toHaveBeenCalled();
  });

  it('task:status-update event forwarded to all BrowserWindows as a2a:task-status-update', () => {
    const wc1 = { send: vi.fn() };
    const wc2 = { send: vi.fn() };
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      { isDestroyed: () => false, webContents: wc1 },
      { isDestroyed: () => false, webContents: wc2 },
    ] as never);

    const payload: TaskStatusUpdateEvent = {
      taskId: 'task-1',
      contextId: 'ctx-1',
      status: { state: 'working' },
    };
    ipcEmitter.emit('task:status-update', payload);

    expect(wc1.send).toHaveBeenCalledWith('a2a:task-status-update', payload);
    expect(wc2.send).toHaveBeenCalledWith('a2a:task-status-update', payload);
  });

  it('task:artifact-update event forwarded to all BrowserWindows as a2a:task-artifact-update', () => {
    const wc1 = { send: vi.fn() };
    const wc2 = { send: vi.fn() };
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      { isDestroyed: () => false, webContents: wc1 },
      { isDestroyed: () => false, webContents: wc2 },
    ] as never);

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

  it('a2a:getTask returns task from TaskManager', async () => {
    const task = { id: 'task-1', contextId: 'ctx-1', status: { state: 'completed' } };
    mockTaskManager.getTask.mockReturnValue(task);
    const result = await getHandler('a2a:getTask')({ sender: {} }, 'task-1', 5);
    expect(mockTaskManager.getTask).toHaveBeenCalledWith('task-1', 5);
    expect(result).toEqual(task);
  });

  it('a2a:listTasks returns task list from TaskManager', async () => {
    const response = { tasks: [], nextPageToken: '', pageSize: 0, totalSize: 0 };
    mockTaskManager.listTasks.mockReturnValue(response);
    const filter = { contextId: 'ctx-1', status: 'working' };
    const result = await getHandler('a2a:listTasks')({ sender: {} }, filter);
    expect(mockTaskManager.listTasks).toHaveBeenCalledWith(filter);
    expect(result).toEqual(response);
  });

  it('a2a:cancelTask returns updated task', async () => {
    const task = { id: 'task-1', contextId: 'ctx-1', status: { state: 'canceled' } };
    mockTaskManager.cancelTask.mockReturnValue(task);
    const result = await getHandler('a2a:cancelTask')({ sender: {} }, 'task-1');
    expect(mockTaskManager.cancelTask).toHaveBeenCalledWith('task-1');
    expect(result).toEqual(task);
  });

  it('a2a:cancelTask rejects when TaskManager throws', async () => {
    mockTaskManager.cancelTask.mockImplementation(() => {
      throw new Error('Task task-1 not found');
    });
    await expect(getHandler('a2a:cancelTask')({ sender: {} }, 'task-1')).rejects.toThrow(
      'Task task-1 not found',
    );
  });

  it('a2a:cancelTask rejects empty taskId with IpcValidationError', async () => {
    const { IpcValidationError } = await import('../../contracts/errors');
    await expect(getHandler('a2a:cancelTask')({ sender: {} }, '')).rejects.toBeInstanceOf(
      IpcValidationError,
    );
  });

  it('a2a:getTask rejects negative historyLength with IpcValidationError', async () => {
    const { IpcValidationError } = await import('../../contracts/errors');
    await expect(getHandler('a2a:getTask')({ sender: {} }, 't1', -5)).rejects.toBeInstanceOf(
      IpcValidationError,
    );
  });
});
