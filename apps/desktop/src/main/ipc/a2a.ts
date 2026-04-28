import { ipcMain, BrowserWindow } from 'electron';
import type { EventEmitter } from 'events';
import type { AgentCardRegistry, Message, TaskArtifactUpdateEvent, TaskManager, TaskState, TaskStatusUpdateEvent } from '@chamber/services';

interface A2AIncomingPayload {
  targetMindId: string;
  message: Message;
  replyMessageId: string;
}

const VALID_TASK_STATES: ReadonlySet<TaskState> = new Set([
  'submitted',
  'working',
  'completed',
  'failed',
  'canceled',
  'input-required',
  'rejected',
  'auth-required',
]);

function narrowTaskState(value: unknown): TaskState | undefined {
  return typeof value === 'string' && VALID_TASK_STATES.has(value as TaskState)
    ? (value as TaskState)
    : undefined;
}

function isA2AIncomingPayload(value: unknown): value is A2AIncomingPayload {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Partial<A2AIncomingPayload>;
  const message = payload.message as Partial<Message> | undefined;
  return (
    typeof payload.targetMindId === 'string' &&
    typeof payload.replyMessageId === 'string' &&
    !!message &&
    typeof message.messageId === 'string' &&
    (message.role === 'user' || message.role === 'agent') &&
    Array.isArray(message.parts)
  );
}

export function setupA2AIPC(
  ipcEmitter: EventEmitter,
  agentCardRegistry: AgentCardRegistry,
  taskManager: TaskManager,
): void {
  ipcMain.on('e2e:is-enabled', (event) => {
    event.returnValue = process.env.CHAMBER_E2E === '1';
  });

  // Forward a2a:incoming events to all renderer windows
  ipcEmitter.on('a2a:incoming', (payload: A2AIncomingPayload) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('a2a:incoming', payload);
    }
  });

  // Forward A2A chat events (streaming from target agent) to all renderer windows
  ipcEmitter.on('a2a:chat-event', (payload: { mindId: string; messageId: string; event: unknown }) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('chat:event', payload.mindId, payload.messageId, payload.event);
    }
  });

  // Forward task events to all renderer windows
  ipcEmitter.on('task:status-update', (payload: TaskStatusUpdateEvent) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('a2a:task-status-update', payload);
    }
  });

  ipcEmitter.on('task:artifact-update', (payload: TaskArtifactUpdateEvent) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('a2a:task-artifact-update', payload);
    }
  });

  ipcMain.handle('a2a:listAgents', async () => {
    return agentCardRegistry.getCards();
  });

  // Task query handlers
  ipcMain.handle('a2a:getTask', async (_, taskId: string, historyLength?: number) => {
    return taskManager.getTask(taskId, historyLength);
  });

  ipcMain.handle('a2a:listTasks', async (_, filter?: { contextId?: string; status?: string }) => {
    return taskManager.listTasks(
      filter ? { contextId: filter.contextId, status: narrowTaskState(filter.status) } : undefined,
    );
  });

  ipcMain.handle('a2a:cancelTask', async (_, taskId: string) => {
    return taskManager.cancelTask(taskId);
  });

  if (process.env.CHAMBER_E2E === '1') {
    ipcMain.handle('e2e:a2a:incoming', async (_, payload: unknown) => {
      if (!isA2AIncomingPayload(payload)) {
        throw new Error('Invalid E2E A2A incoming payload');
      }
      ipcEmitter.emit('a2a:incoming', payload);
    });
  }
}
