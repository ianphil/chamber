import { BrowserWindow, ipcMain } from 'electron';
import type { DesktopUpdateState } from '@chamber/shared/types';
import type { UpdaterService } from '../updater/UpdaterService';

function broadcastState(state: DesktopUpdateState): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('updater:state-changed', state);
  }
}

export function setupUpdaterIPC(updaterService: UpdaterService): void {
  ipcMain.handle('updater:get-state', () => updaterService.getState());
  ipcMain.handle('updater:check', () => updaterService.checkForUpdates('web-ui'));
  ipcMain.handle('updater:download', () => updaterService.downloadUpdate());
  ipcMain.handle('updater:install-and-restart', () => updaterService.installAndRestart());

  updaterService.onStateChanged((state) => {
    broadcastState(state);
  });
}
