import { ipcMain, BrowserWindow } from 'electron';
import type { EventEmitter } from 'events';
import { IPC } from '@chamber/shared';
import type { AgentCardRegistry, TaskManager } from '@chamber/services';
import { isA2AIncomingPayload, narrowTaskState } from '@chamber/shared/a2a-types';
import type { A2AIncomingPayload, TaskArtifactUpdateEvent, TaskStatusUpdateEvent } from '@chamber/shared/a2a-types';

export function setupA2AIPC(
  ipcEmitter: EventEmitter,
  agentCardRegistry: AgentCardRegistry,
  taskManager: TaskManager,
): void {
  ipcMain.on(IPC.E2E.IS_ENABLED, (event) => {
    event.returnValue = process.env.CHAMBER_E2E === '1';
  });

  // Forward a2a:incoming events to all renderer windows.
  // Note: 'a2a:incoming' on the EventEmitter is an internal main-process bus
  // event name that happens to share the wire-channel string; the
  // webContents.send call uses the IPC.A2A.INCOMING constant for the IPC wire.
  ipcEmitter.on('a2a:incoming', (payload: A2AIncomingPayload) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC.A2A.INCOMING, payload);
    }
  });

  // Forward A2A chat events (streaming from target agent) to all renderer windows
  ipcEmitter.on('a2a:chat-event', (payload: { mindId: string; messageId: string; event: unknown }) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC.CHAT.EVENT, payload.mindId, payload.messageId, payload.event);
    }
  });

  // Forward task events to all renderer windows
  ipcEmitter.on('task:status-update', (payload: TaskStatusUpdateEvent) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC.A2A.TASK_STATUS_UPDATE, payload);
    }
  });

  ipcEmitter.on('task:artifact-update', (payload: TaskArtifactUpdateEvent) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC.A2A.TASK_ARTIFACT_UPDATE, payload);
    }
  });

  ipcMain.handle(IPC.A2A.LIST_AGENTS, async () => {
    return agentCardRegistry.getCards();
  });

  // Task query handlers
  ipcMain.handle(IPC.A2A.GET_TASK, async (_, taskId: string, historyLength?: number) => {
    return taskManager.getTask(taskId, historyLength);
  });

  ipcMain.handle(IPC.A2A.LIST_TASKS, async (_, filter?: { contextId?: string; status?: string }) => {
    return taskManager.listTasks(
      filter ? { contextId: filter.contextId, status: narrowTaskState(filter.status) } : undefined,
    );
  });

  ipcMain.handle(IPC.A2A.CANCEL_TASK, async (_, taskId: string) => {
    return taskManager.cancelTask(taskId);
  });

  if (process.env.CHAMBER_E2E === '1') {
    ipcMain.handle(IPC.E2E.A2A_INCOMING, async (_, payload: unknown) => {
      if (!isA2AIncomingPayload(payload)) {
        throw new Error('Invalid E2E A2A incoming payload');
      }
      ipcEmitter.emit('a2a:incoming', payload);
    });
  }
}
