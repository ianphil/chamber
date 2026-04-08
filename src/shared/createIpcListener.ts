import { IpcRenderer } from 'electron';

export function createIpcListener<T extends unknown[]>(
  ipcRenderer: IpcRenderer,
  channel: string,
  callback: (...args: T) => void,
): () => void {
  const handler = (_event: Electron.IpcRendererEvent, ...args: T) => {
    callback(...args);
  };
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}
