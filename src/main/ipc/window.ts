import { ipcMain, type BrowserWindow } from 'electron';
import type { Dispatcher } from '../rpc/dispatcher';
import { makeIpcSendBridge } from './bridge';
import {
  WindowCloseArgs,
  WindowMaximizeArgs,
  WindowMinimizeArgs,
} from '../../contracts/window';

const WINDOW_CHANNELS = ['window:minimize', 'window:maximize', 'window:close'] as const;

/**
 * Wires window:* control channels. These use `ipcMain.on` (send, not
 * invoke), so invalid payloads are logged and dropped rather than
 * rejected. All three are electron-only: WS callers get -32601.
 */
export function setupWindowIPC(
  dispatcher: Dispatcher,
  getMainWindow: () => BrowserWindow | null,
): void {
  dispatcher.register('window:minimize', WindowMinimizeArgs, async () => {
    getMainWindow()?.minimize();
  });

  dispatcher.register('window:maximize', WindowMaximizeArgs, async () => {
    const win = getMainWindow();
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });

  dispatcher.register('window:close', WindowCloseArgs, async () => {
    getMainWindow()?.close();
  });

  for (const channel of WINDOW_CHANNELS) {
    ipcMain.on(channel, makeIpcSendBridge(dispatcher, channel));
  }
}
