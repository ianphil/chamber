import { contextBridge, ipcRenderer } from 'electron';
import { createIpcListener } from './shared/createIpcListener';
import type { ElectronAPI } from './shared/types';

const electronAPI: ElectronAPI = {
  chat: {
    send: (conversationId, message, messageId) =>
      ipcRenderer.invoke('chat:send', conversationId, message, messageId),
    stop: (conversationId, messageId) =>
      ipcRenderer.invoke('chat:stop', conversationId, messageId),
    newConversation: (conversationId) =>
      ipcRenderer.invoke('chat:newConversation', conversationId),
    onEvent: (callback) => createIpcListener(ipcRenderer, 'chat:event', callback),
  },
  agent: {
    getStatus: () => ipcRenderer.invoke('agent:getStatus'),
    selectMindDirectory: () => ipcRenderer.invoke('agent:selectMindDirectory'),
    setMindPath: (mindPath) => ipcRenderer.invoke('agent:setMindPath', mindPath),
    onStatusChanged: (callback) => createIpcListener(ipcRenderer, 'agent:statusChanged', callback),
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

