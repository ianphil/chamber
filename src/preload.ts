import { contextBridge, ipcRenderer } from 'electron';
import { createIpcListener } from './shared/createIpcListener';
import type { ElectronAPI } from './shared/types';

const electronAPI: ElectronAPI = {
  chat: {
    send: (mindId, message, messageId, model) =>
      ipcRenderer.invoke('chat:send', mindId, message, messageId, model),
    stop: (mindId, messageId) =>
      ipcRenderer.invoke('chat:stop', mindId, messageId),
    newConversation: (mindId) =>
      ipcRenderer.invoke('chat:newConversation', mindId),
    listModels: () => ipcRenderer.invoke('chat:listModels'),
    onEvent: (callback) => createIpcListener(ipcRenderer, 'chat:event', callback),
  },
  mind: {
    add: (mindPath) => ipcRenderer.invoke('mind:add', mindPath),
    remove: (mindId) => ipcRenderer.invoke('mind:remove', mindId),
    list: () => ipcRenderer.invoke('mind:list'),
    setActive: (mindId) => ipcRenderer.invoke('mind:setActive', mindId),
    selectDirectory: () => ipcRenderer.invoke('mind:selectDirectory'),
    openWindow: (mindId) => ipcRenderer.invoke('mind:openWindow', mindId),
    onMindChanged: (callback) => createIpcListener(ipcRenderer, 'mind:changed', callback),
  },
  agent: {
    getStatus: () => ipcRenderer.invoke('agent:getStatus'),
    selectMindDirectory: () => ipcRenderer.invoke('agent:selectMindDirectory'),
    setMindPath: (mindPath) => ipcRenderer.invoke('agent:setMindPath', mindPath),
    onStatusChanged: (callback) => createIpcListener(ipcRenderer, 'agent:statusChanged', callback),
  },
  lens: {
    getViews: (mindId?) => ipcRenderer.invoke('lens:getViews', mindId),
    getViewData: (viewId, mindId?) => ipcRenderer.invoke('lens:getViewData', viewId, mindId),
    refreshView: (viewId, mindId?) => ipcRenderer.invoke('lens:refreshView', viewId, mindId),
    sendAction: (viewId, action, mindId?) => ipcRenderer.invoke('lens:sendAction', viewId, action, mindId),
    onViewsChanged: (callback) =>
      createIpcListener(ipcRenderer, 'lens:viewsChanged', callback),
  },
  auth: {
    getStatus: () => ipcRenderer.invoke('auth:getStatus'),
    startLogin: () => ipcRenderer.invoke('auth:startLogin'),
    onProgress: (callback) =>
      createIpcListener(ipcRenderer, 'auth:progress', callback),
  },
  genesis: {
    getDefaultPath: () => ipcRenderer.invoke('genesis:getDefaultPath'),
    pickPath: () => ipcRenderer.invoke('genesis:pickPath'),
    create: (config) => ipcRenderer.invoke('genesis:create', config),
    onProgress: (callback) =>
      createIpcListener(ipcRenderer, 'genesis:progress', callback),
  },
  config: {
    load: () => ipcRenderer.invoke('config:load'),
    save: (config) => ipcRenderer.invoke('config:save', config),
  },
  a2a: {
    onIncoming: (callback: (payload: any) => void) => createIpcListener(ipcRenderer, 'a2a:incoming', callback),
    listAgents: () => ipcRenderer.invoke('a2a:listAgents'),
  },
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
