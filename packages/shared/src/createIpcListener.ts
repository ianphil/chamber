import { IpcRenderer } from 'electron';
import type { IpcChannel } from './ipc-channels';

/**
 * Subscribe to an IPC channel from the renderer. The channel must be one of
 * the `IpcChannel` literals declared in `./ipc-channels`; arbitrary strings
 * are rejected at compile time so the channel constants are a real contract,
 * not decoration.
 */
export function createIpcListener<T extends unknown[]>(
  ipcRenderer: IpcRenderer,
  channel: IpcChannel,
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
