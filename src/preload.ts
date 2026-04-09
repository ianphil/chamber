import { contextBridge, ipcRenderer } from 'electron';
import { createIpcListener } from './shared/createIpcListener';
import type { ElectronAPI } from './shared/types';

const electronAPI: ElectronAPI = {
  chat: {
    send: (conversationId, message, messageId, model) =>
      ipcRenderer.invoke('chat:send', conversationId, message, messageId, model),
    stop: (conversationId, messageId) =>
      ipcRenderer.invoke('chat:stop', conversationId, messageId),
    newConversation: (conversationId) =>
      ipcRenderer.invoke('chat:newConversation', conversationId),
    listModels: () => ipcRenderer.invoke('chat:listModels'),
    onEvent: (callback) => createIpcListener(ipcRenderer, 'chat:event', callback),
  },
  agent: {
    getStatus: () => ipcRenderer.invoke('agent:getStatus'),
    selectMindDirectory: () => ipcRenderer.invoke('agent:selectMindDirectory'),
    setMindPath: (mindPath) => ipcRenderer.invoke('agent:setMindPath', mindPath),
    onStatusChanged: (callback) => createIpcListener(ipcRenderer, 'agent:statusChanged', callback),
  },
  lens: {
    getViews: () => ipcRenderer.invoke('lens:getViews'),
    getViewData: (viewId: string) => ipcRenderer.invoke('lens:getViewData', viewId),
    refreshView: (viewId: string) => ipcRenderer.invoke('lens:refreshView', viewId),
    sendAction: (viewId: string, action: string) => ipcRenderer.invoke('lens:sendAction', viewId, action),
    onViewsChanged: (callback: (views: import('./shared/types').LensViewManifest[]) => void) =>
      createIpcListener(ipcRenderer, 'lens:viewsChanged', callback),
  },
  genesis: {
    getDefaultPath: () => ipcRenderer.invoke('genesis:getDefaultPath'),
    pickPath: () => ipcRenderer.invoke('genesis:pickPath'),
    create: (config: { name: string; role: string; voice: string; voiceDescription: string; basePath: string }) =>
      ipcRenderer.invoke('genesis:create', config),
    onProgress: (callback: (progress: { step: string; detail: string }) => void) =>
      createIpcListener(ipcRenderer, 'genesis:progress', callback),
  },
  config: {
    load: () => ipcRenderer.invoke('config:load'),
    save: (config) => ipcRenderer.invoke('config:save', config),
  },
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

