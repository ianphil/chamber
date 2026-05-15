import { ipcMain, BrowserWindow } from 'electron';
import type { EventEmitter } from 'events';
import { IPC } from '@chamber/shared';
import type { AppConfig } from '@chamber/shared/types';
import { EntraA2AAuthProvider, StaticA2ARelayAuthProvider, type A2ARelayModeService, type AgentCardRegistry, type CredentialStore, type EntraA2ATokenCache, type EntraA2ATokenCacheEntry, type TaskManager } from '@chamber/services';
import { isA2AIncomingPayload, isA2ARelayConnectRequest, narrowTaskState } from '@chamber/shared/a2a-types';
import type { A2AIncomingPayload, A2ARelayConnectRequest, A2ARelayStatus, TaskArtifactUpdateEvent, TaskStatusUpdateEvent } from '@chamber/shared/a2a-types';

const DEFAULT_SWITCHBOARD_AUTH_CLIENT_ID = '074530a3-b6c5-41c8-896c-4a6651bf5f16';
const A2A_RELAY_CREDENTIAL_SERVICE = 'chamber-a2a-relay';
const A2A_RELAY_ENTRA_CREDENTIAL_SERVICE = 'chamber-a2a-relay-entra';

interface A2ARelayIPCOptions {
  relayModeService?: A2ARelayModeService;
  configStore?: {
    load(): AppConfig;
    save(config: AppConfig): void;
  };
  credentialStore?: CredentialStore;
}

export function setupA2AIPC(
  ipcEmitter: EventEmitter,
  agentCardRegistry: AgentCardRegistry,
  taskManager: TaskManager,
  relayOptions: A2ARelayIPCOptions = {},
): void {
  let relayStatus: A2ARelayStatus = createDisconnectedStatus(
    loadSavedRelayBaseUrl(relayOptions.configStore),
    loadSavedRelayAuthMode(relayOptions.configStore),
  );

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

  ipcMain.handle(IPC.A2A.RELAY_STATUS, async () => refreshRelayStatus(
    await withStoredRelayTokenStatus(relayStatus, relayOptions.credentialStore),
    relayOptions.relayModeService,
  ));

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
      authMode: getPersistedRelayAuthMode(request),
      publishedBaseUrl: null,
      lastError: null,
    });

    try {
      await relayOptions.relayModeService.connect({
        baseUrl: request.relayBaseUrl,
        authProvider: await createRelayAuthProvider(request, relayOptions.credentialStore),
      });
      await saveRelayToken(relayOptions.credentialStore, request);
      const nextStatus = await refreshRelayStatus({
        state: 'connected',
        mode: 'relay',
        relayBaseUrl: request.relayBaseUrl,
        authMode: getPersistedRelayAuthMode(request),
        hasStoredRelayToken: await hasStoredRelayToken(relayOptions.credentialStore, request.relayBaseUrl),
        publishedBaseUrl: null,
        publishedAgentCount: 0,
        relayAgentCount: 0,
        lastError: null,
        connectedAt: Date.now(),
      }, relayOptions.relayModeService);
      emitRelayStatus(nextStatus);
      saveRelaySettings(relayOptions.configStore, request.relayBaseUrl, nextStatus.authMode ?? getPersistedRelayAuthMode(request));
      return nextStatus;
    } catch (error) {
      await relayOptions.relayModeService.disconnect().catch(() => undefined);
      const message = error instanceof Error ? error.message : String(error);
      const nextStatus: A2ARelayStatus = {
        ...createDisconnectedStatus(request.relayBaseUrl),
        state: 'error',
        authMode: getPersistedRelayAuthMode(request),
        hasStoredRelayToken: await hasStoredRelayToken(relayOptions.credentialStore, request.relayBaseUrl),
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
    const nextStatus = createDisconnectedStatus(relayStatus.relayBaseUrl, relayStatus.authMode);
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

async function createRelayAuthProvider(
  request: A2ARelayConnectRequest,
  credentialStore?: CredentialStore,
): Promise<StaticA2ARelayAuthProvider | EntraA2AAuthProvider> {
  const mode = request.authMode ?? 'static';
  if (mode === 'static' || mode === 'auto') {
    const token = 'relayToken' in request && request.relayToken?.trim()
      ? request.relayToken.trim()
      : await getStoredRelayToken(credentialStore, request.relayBaseUrl);
    if (mode === 'auto' && !token) {
      return createInteractiveRelayAuthProvider(request, credentialStore);
    }
    if (!token) throw new Error('A2A relay token is not configured');
    return new StaticA2ARelayAuthProvider(token);
  }

  return createInteractiveRelayAuthProvider(request, credentialStore);
}

function createInteractiveRelayAuthProvider(
  request: A2ARelayConnectRequest,
  credentialStore?: CredentialStore,
): EntraA2AAuthProvider {
  const clientId = 'clientId' in request && request.clientId
    ? request.clientId
    : process.env.SWITCHBOARD_AUTH_CLIENT_ID ?? process.env.CHAMBER_A2A_CLIENT_ID ?? DEFAULT_SWITCHBOARD_AUTH_CLIENT_ID;
  const tenantId = 'tenantId' in request ? request.tenantId : process.env.CHAMBER_A2A_TENANT_ID;
  const scope = 'scope' in request ? request.scope : process.env.CHAMBER_A2A_SCOPE;
  return new EntraA2AAuthProvider({
    clientId,
    tenantId,
    scope,
    tokenCache: createEntraRelayTokenCache(credentialStore, {
      relayBaseUrl: request.relayBaseUrl,
      clientId,
      tenantId,
      scope,
    }),
  });
}

function createDisconnectedStatus(relayBaseUrl: string | null = null, authMode?: 'static' | 'interactive'): A2ARelayStatus {
  return {
    state: 'disconnected',
    mode: 'local',
    relayBaseUrl,
    ...(authMode ? { authMode } : {}),
    hasStoredRelayToken: false,
    publishedBaseUrl: null,
    publishedAgentCount: 0,
    relayAgentCount: 0,
    lastError: null,
    connectedAt: null,
  };
}

function loadSavedRelayBaseUrl(configStore: A2ARelayIPCOptions['configStore']): string | null {
  const value = configStore?.load().a2aRelayBaseUrl;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function loadSavedRelayAuthMode(configStore: A2ARelayIPCOptions['configStore']): 'static' | 'interactive' | undefined {
  const value = configStore?.load().a2aRelayAuthMode;
  return value === 'static' || value === 'interactive' ? value : undefined;
}

function saveRelaySettings(
  configStore: A2ARelayIPCOptions['configStore'],
  relayBaseUrl: string,
  authMode: 'static' | 'interactive',
): void {
  if (!configStore) return;
  const config = configStore.load();
  configStore.save({ ...config, a2aRelayBaseUrl: relayBaseUrl, a2aRelayAuthMode: authMode });
}

function getPersistedRelayAuthMode(request: A2ARelayConnectRequest): 'static' | 'interactive' {
  return request.authMode === 'interactive' ? 'interactive' : 'static';
}

async function withStoredRelayTokenStatus(
  status: A2ARelayStatus,
  credentialStore: CredentialStore | undefined,
): Promise<A2ARelayStatus> {
  if (!status.relayBaseUrl) return { ...status, hasStoredRelayToken: false };
  return {
    ...status,
    hasStoredRelayToken: await hasStoredRelayToken(credentialStore, status.relayBaseUrl),
  };
}

async function saveRelayToken(
  credentialStore: CredentialStore | undefined,
  request: A2ARelayConnectRequest,
): Promise<void> {
  if (!credentialStore || !('relayToken' in request) || !request.relayToken?.trim()) return;
  await credentialStore.setPassword(
    A2A_RELAY_CREDENTIAL_SERVICE,
    getRelayCredentialAccount(request.relayBaseUrl),
    request.relayToken.trim(),
  );
}

async function hasStoredRelayToken(credentialStore: CredentialStore | undefined, relayBaseUrl: string): Promise<boolean> {
  return Boolean(await getStoredRelayToken(credentialStore, relayBaseUrl));
}

async function getStoredRelayToken(credentialStore: CredentialStore | undefined, relayBaseUrl: string): Promise<string | null> {
  if (!credentialStore) return null;
  const account = getRelayCredentialAccount(relayBaseUrl);
  const credential = (await credentialStore.findCredentials(A2A_RELAY_CREDENTIAL_SERVICE))
    .find((entry) => entry.account === account);
  return credential?.password?.trim() || null;
}

function getRelayCredentialAccount(relayBaseUrl: string): string {
  return URL.canParse(relayBaseUrl) ? new URL(relayBaseUrl).origin : relayBaseUrl.trim();
}

function createEntraRelayTokenCache(
  credentialStore: CredentialStore | undefined,
  options: { relayBaseUrl: string; clientId: string; tenantId?: string; scope?: string },
): EntraA2ATokenCache | undefined {
  if (!credentialStore) return undefined;
  const account = getEntraRelayCredentialAccount(options);
  return {
    async load() {
      const credential = (await credentialStore.findCredentials(A2A_RELAY_ENTRA_CREDENTIAL_SERVICE))
        .find((entry) => entry.account === account);
      if (!credential?.password) return null;
      const entry = parseEntraRelayTokenCacheEntry(credential.password);
      if (!entry) await credentialStore.deletePassword(A2A_RELAY_ENTRA_CREDENTIAL_SERVICE, account);
      return entry;
    },
    async save(entry) {
      await credentialStore.setPassword(
        A2A_RELAY_ENTRA_CREDENTIAL_SERVICE,
        account,
        JSON.stringify(entry),
      );
    },
    async clear() {
      await credentialStore.deletePassword(A2A_RELAY_ENTRA_CREDENTIAL_SERVICE, account);
    },
  };
}

function parseEntraRelayTokenCacheEntry(value: string): EntraA2ATokenCacheEntry | null {
  if (value.trim().length > 0 && !value.trim().startsWith('{')) {
    return { refreshToken: value.trim() };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  return typeof record.refreshToken === 'string' && record.refreshToken.trim().length > 0
    ? { refreshToken: record.refreshToken.trim() }
    : null;
}

function getEntraRelayCredentialAccount(options: { relayBaseUrl: string; clientId: string; tenantId?: string; scope?: string }): string {
  return [
    getRelayCredentialAccount(options.relayBaseUrl),
    options.clientId.trim(),
    options.tenantId?.trim() || 'common',
    options.scope?.trim() || `api://${options.clientId}/user_impersonation`,
  ].join('|');
}

async function refreshRelayStatus(
  status: A2ARelayStatus,
  relayModeService?: A2ARelayModeService,
): Promise<A2ARelayStatus> {
  if (!relayModeService?.isConnected()) {
    return status.state === 'error'
      ? status
      : {
          ...createDisconnectedStatus(status.relayBaseUrl, status.authMode),
          hasStoredRelayToken: status.hasStoredRelayToken,
        };
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
