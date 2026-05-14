import { ipcMain, BrowserWindow } from 'electron';
import type { EventEmitter } from 'events';
import { IPC } from '@chamber/shared';
import { EntraA2AAuthProvider, StaticA2ARelayAuthProvider, type A2ARelayModeService, type AgentCardRegistry, type TaskManager } from '@chamber/services';
import { isA2AIncomingPayload, isA2ARelayConnectRequest, narrowTaskState } from '@chamber/shared/a2a-types';
import type { A2AIncomingPayload, A2ARelayConnectRequest, A2ARelayStatus, TaskArtifactUpdateEvent, TaskStatusUpdateEvent } from '@chamber/shared/a2a-types';

const DEFAULT_SWITCHBOARD_AUTH_CLIENT_ID = '074530a3-b6c5-41c8-896c-4a6651bf5f16';

interface A2ARelayIPCOptions {
  relayModeService?: A2ARelayModeService;
}

export function setupA2AIPC(
  ipcEmitter: EventEmitter,
  agentCardRegistry: AgentCardRegistry,
  taskManager: TaskManager,
  relayOptions: A2ARelayIPCOptions = {},
): void {
  let relayStatus: A2ARelayStatus = createDisconnectedStatus();

  const emitRelayStatus = (status: A2ARelayStatus) => {
    relayStatus = status;
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC.A2A.RELAY_STATE_CHANGED, status);
    }
  };

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

  ipcMain.handle(IPC.A2A.RELAY_STATUS, async () => refreshRelayStatus(relayStatus, relayOptions.relayModeService));

  ipcMain.handle(IPC.A2A.RELAY_CONNECT, async (_, request: unknown) => {
    if (!relayOptions.relayModeService) {
      throw new Error('A2A relay control is unavailable');
    }
    if (!isA2ARelayConnectRequest(request)) {
      throw new Error('Invalid A2A relay connect request');
    }

    emitRelayStatus({
      ...relayStatus,
      state: 'connecting',
      mode: 'local',
      relayBaseUrl: request.relayBaseUrl,
      publishedBaseUrl: null,
      lastError: null,
    });

    try {
      await relayOptions.relayModeService.connect({
        baseUrl: request.relayBaseUrl,
        authProvider: createRelayAuthProvider(request),
      });
      const nextStatus = await refreshRelayStatus({
        state: 'connected',
        mode: 'relay',
        relayBaseUrl: request.relayBaseUrl,
        publishedBaseUrl: null,
        publishedAgentCount: 0,
        relayAgentCount: 0,
        lastError: null,
        connectedAt: Date.now(),
      }, relayOptions.relayModeService);
      emitRelayStatus(nextStatus);
      return nextStatus;
    } catch (error) {
      await relayOptions.relayModeService.disconnect().catch(() => undefined);
      const message = error instanceof Error ? error.message : String(error);
      const nextStatus: A2ARelayStatus = {
        ...createDisconnectedStatus(),
        state: 'error',
        lastError: message,
      };
      emitRelayStatus(nextStatus);
      throw error;
    }
  });

  ipcMain.handle(IPC.A2A.RELAY_DISCONNECT, async () => {
    if (!relayOptions.relayModeService) {
      return relayStatus;
    }
    emitRelayStatus({ ...relayStatus, state: 'disconnecting' });
    await relayOptions.relayModeService.disconnect();
    const nextStatus = createDisconnectedStatus();
    emitRelayStatus(nextStatus);
    return nextStatus;
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

function createRelayAuthProvider(request: A2ARelayConnectRequest): StaticA2ARelayAuthProvider | EntraA2AAuthProvider {
  const mode = request.authMode ?? 'static';
  if ('relayToken' in request && request.relayToken && (mode === 'static' || mode === 'auto')) {
    return new StaticA2ARelayAuthProvider(request.relayToken);
  }

  const clientId = 'clientId' in request && request.clientId
    ? request.clientId
    : process.env.SWITCHBOARD_AUTH_CLIENT_ID ?? process.env.CHAMBER_A2A_CLIENT_ID ?? DEFAULT_SWITCHBOARD_AUTH_CLIENT_ID;
  return new EntraA2AAuthProvider({
    clientId,
    tenantId: 'tenantId' in request ? request.tenantId : process.env.CHAMBER_A2A_TENANT_ID,
    scope: 'scope' in request ? request.scope : process.env.CHAMBER_A2A_SCOPE,
  });
}

function createDisconnectedStatus(): A2ARelayStatus {
  return {
    state: 'disconnected',
    mode: 'local',
    relayBaseUrl: null,
    publishedBaseUrl: null,
    publishedAgentCount: 0,
    relayAgentCount: 0,
    lastError: null,
    connectedAt: null,
  };
}

async function refreshRelayStatus(
  status: A2ARelayStatus,
  relayModeService?: A2ARelayModeService,
): Promise<A2ARelayStatus> {
  if (!relayModeService?.isConnected()) {
    return status.state === 'error' ? status : createDisconnectedStatus();
  }
  return {
    ...status,
    state: 'connected',
    mode: 'relay',
    publishedAgentCount: relayModeService.getPublishedAgentCount(),
    relayAgentCount: await relayModeService.getRelayAgentCount(),
    lastError: relayModeService.getLastPollError(),
  };
}
