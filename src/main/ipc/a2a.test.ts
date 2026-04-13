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
import type { TaskStatusUpdateEvent, TaskArtifactUpdateEvent } from '../services/a2a/types';
import type { AgentCardRegistry } from '../services/a2a/AgentCardRegistry';
import type { TaskManager } from '../services/a2a/TaskManager';

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
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
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
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([{ webContents: mockWebContents }]);

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
    const handleCalls = vi.mocked(ipcMain.handle).mock.calls;
    const listHandler = handleCalls.find((c) => c[0] === 'a2a:listAgents');
    expect(listHandler).toBeDefined();

    const result = await listHandler[1]({});
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
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      { webContents: wc1 },
      { webContents: wc2 },
    ]);

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
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      { webContents: wc1 },
      { webContents: wc2 },
    ]);

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

    const handleCalls = vi.mocked(ipcMain.handle).mock.calls;
    const handler = handleCalls.find((c) => c[0] === 'a2a:getTask');
    expect(handler).toBeDefined();

    const result = await handler[1]({}, 'task-1', 5);
    expect(mockTaskManager.getTask).toHaveBeenCalledWith('task-1', 5);
    expect(result).toEqual(task);
  });

  it('a2a:listTasks handle returns task list from TaskManager', async () => {
    const response = { tasks: [], nextPageToken: '', pageSize: 0, totalSize: 0 };
    mockTaskManager.listTasks.mockReturnValue(response);

    const handleCalls = vi.mocked(ipcMain.handle).mock.calls;
    const handler = handleCalls.find((c) => c[0] === 'a2a:listTasks');
    expect(handler).toBeDefined();

    const filter = { contextId: 'ctx-1', status: 'working' };
    const result = await handler[1]({}, filter);
    expect(mockTaskManager.listTasks).toHaveBeenCalledWith(filter);
    expect(result).toEqual(response);
  });

  it('a2a:cancelTask handle returns updated task', async () => {
    const task = { id: 'task-1', contextId: 'ctx-1', status: { state: 'canceled' } };
    mockTaskManager.cancelTask.mockReturnValue(task);

    const handleCalls = vi.mocked(ipcMain.handle).mock.calls;
    const handler = handleCalls.find((c) => c[0] === 'a2a:cancelTask');
    expect(handler).toBeDefined();

    const result = await handler[1]({}, 'task-1');
    expect(mockTaskManager.cancelTask).toHaveBeenCalledWith('task-1');
    expect(result).toEqual(task);
  });

  it('a2a:cancelTask rejects when TaskManager throws', async () => {
    mockTaskManager.cancelTask.mockImplementation(() => {
      throw new Error('Task task-1 not found');
    });

    const handleCalls = vi.mocked(ipcMain.handle).mock.calls;
    const handler = handleCalls.find((c) => c[0] === 'a2a:cancelTask');
    expect(handler).toBeDefined();

    await expect(handler[1]({}, 'task-1')).rejects.toThrow('Task task-1 not found');
  });
});
