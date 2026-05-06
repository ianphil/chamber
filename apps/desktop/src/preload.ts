import { contextBridge, ipcRenderer } from 'electron';
import { createIpcListener } from '@chamber/shared';
import type { A2AIncomingPayload, ElectronAPI } from '@chamber/shared/types';
import type { Message, TaskArtifactUpdateEvent, TaskStatusUpdateEvent } from '@chamber/shared/a2a-types';

const electronAPI: ElectronAPI = {
  chat: {
    send: (mindId, message, messageId, model, attachments) =>
      ipcRenderer.invoke('chat:send', mindId, message, messageId, model, attachments),
    stop: (mindId, messageId) =>
      ipcRenderer.invoke('chat:stop', mindId, messageId),
    newConversation: (mindId) =>
      ipcRenderer.invoke('chat:newConversation', mindId),
    listModels: (mindId?) => ipcRenderer.invoke('chat:listModels', mindId),
    onEvent: (callback) => createIpcListener(ipcRenderer, 'chat:event', callback),
  },
  mind: {
    add: (mindPath) => ipcRenderer.invoke('mind:add', mindPath),
    remove: (mindId) => ipcRenderer.invoke('mind:remove', mindId),
    list: () => ipcRenderer.invoke('mind:list'),
    setActive: (mindId) => ipcRenderer.invoke('mind:setActive', mindId),
    setModel: (mindId, model) => ipcRenderer.invoke('mind:setModel', mindId, model),
    selectDirectory: () => ipcRenderer.invoke('mind:selectDirectory'),
    openWindow: (mindId) => ipcRenderer.invoke('mind:openWindow', mindId),
    onMindChanged: (callback) => createIpcListener(ipcRenderer, 'mind:changed', callback),
  },
  lens: {
    getViews: (mindId?) => ipcRenderer.invoke('lens:getViews', mindId),
    getViewData: (viewId, mindId?) => ipcRenderer.invoke('lens:getViewData', viewId, mindId),
    refreshView: (viewId, mindId?) => ipcRenderer.invoke('lens:refreshView', viewId, mindId),
    sendAction: (viewId, action, mindId?) => ipcRenderer.invoke('lens:sendAction', viewId, action, mindId),
    getCanvasUrl: (viewId, mindId?) => ipcRenderer.invoke('lens:getCanvasUrl', viewId, mindId),
    onViewsChanged: (callback) => createIpcListener(ipcRenderer, 'lens:viewsChanged', callback),
  },
  auth: {
    getStatus: () => ipcRenderer.invoke('auth:getStatus'),
    listAccounts: () => ipcRenderer.invoke('auth:listAccounts'),
    startLogin: () => ipcRenderer.invoke('auth:startLogin'),
    switchAccount: (login) => ipcRenderer.invoke('auth:switchAccount', login),
    logout: () => ipcRenderer.invoke('auth:logout'),
    onProgress: (callback) => createIpcListener(ipcRenderer, 'auth:progress', callback),
    onAccountSwitchStarted: (callback) => createIpcListener(ipcRenderer, 'auth:accountSwitchStarted', callback),
    onAccountSwitched: (callback) => createIpcListener(ipcRenderer, 'auth:accountSwitched', callback),
    onLoggedOut: (callback) => createIpcListener(ipcRenderer, 'auth:loggedOut', callback),
  },
  genesis: {
    getDefaultPath: () => ipcRenderer.invoke('genesis:getDefaultPath'),
    pickPath: () => ipcRenderer.invoke('genesis:pickPath'),
    listTemplates: () => ipcRenderer.invoke('genesis:listTemplates'),
    create: (config) => ipcRenderer.invoke('genesis:create', config),
    createFromTemplate: (request) => ipcRenderer.invoke('genesis:createFromTemplate', request),
    onProgress: (callback) => createIpcListener(ipcRenderer, 'genesis:progress', callback),
  },
  marketplace: {
    listGenesisRegistries: () => ipcRenderer.invoke('marketplace:listGenesisRegistries'),
    addGenesisRegistry: (url) => ipcRenderer.invoke('marketplace:addGenesisRegistry', url),
    refreshGenesisRegistry: (id) => ipcRenderer.invoke('marketplace:refreshGenesisRegistry', id),
    setGenesisRegistryEnabled: (id, enabled) => ipcRenderer.invoke('marketplace:setGenesisRegistryEnabled', id, enabled),
    removeGenesisRegistry: (id) => ipcRenderer.invoke('marketplace:removeGenesisRegistry', id),
  },
  chatroom: {
    send: (message: string, model?: string) => ipcRenderer.invoke('chatroom:send', message, model),
    history: () => ipcRenderer.invoke('chatroom:history'),
    taskLedger: () => ipcRenderer.invoke('chatroom:task-ledger'),
    clear: () => ipcRenderer.invoke('chatroom:clear'),
    stop: () => ipcRenderer.invoke('chatroom:stop'),
    setOrchestration: (mode: string, config?: unknown) => ipcRenderer.invoke('chatroom:set-orchestration', mode, config),
    getOrchestration: () => ipcRenderer.invoke('chatroom:get-orchestration'),
    onEvent: (callback) => createIpcListener(ipcRenderer, 'chatroom:event', callback),
  },
  updater: {
    getState: () => ipcRenderer.invoke('updater:get-state'),
    check: () => ipcRenderer.invoke('updater:check'),
    download: () => ipcRenderer.invoke('updater:download'),
    installAndRestart: () => ipcRenderer.invoke('updater:install-and-restart'),
    onStateChanged: (callback) => createIpcListener(ipcRenderer, 'updater:state-changed', callback),
  },
  a2a: {
    onIncoming: (callback: (payload: { targetMindId: string; message: Message; replyMessageId: string }) => void) => createIpcListener(ipcRenderer, 'a2a:incoming', callback),
    listAgents: () => ipcRenderer.invoke('a2a:listAgents'),
    onTaskStatusUpdate: (callback: (payload: TaskStatusUpdateEvent & { targetMindId: string }) => void) => createIpcListener(ipcRenderer, 'a2a:task-status-update', callback),
    onTaskArtifactUpdate: (callback: (payload: TaskArtifactUpdateEvent & { targetMindId: string }) => void) => createIpcListener(ipcRenderer, 'a2a:task-artifact-update', callback),
    getTask: (taskId: string, historyLength?: number) => ipcRenderer.invoke('a2a:getTask', taskId, historyLength),
    listTasks: (filter?: { contextId?: string; status?: string }) => ipcRenderer.invoke('a2a:listTasks', filter),
    cancelTask: (taskId: string) => ipcRenderer.invoke('a2a:cancelTask', taskId),
  },
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
  },
};

if (ipcRenderer.sendSync('e2e:is-enabled') === true) {
  electronAPI.e2e = {
    emitA2AIncoming: async (payload: A2AIncomingPayload) => {
      await ipcRenderer.invoke('e2e:a2a:incoming', payload);
    },
  };
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

contextBridge.exposeInMainWorld('desktop', {
  pickFolder: () => ipcRenderer.invoke('mind:selectDirectory'),
  openMindWindow: (mindId: string) => ipcRenderer.invoke('mind:openWindow', mindId),
  getAppBranding: () => ipcRenderer.invoke('desktop:getBranding'),
  confirm: (message: string) => ipcRenderer.invoke('desktop:confirm', message),
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
  },
});
