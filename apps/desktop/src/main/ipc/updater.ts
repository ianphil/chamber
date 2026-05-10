import { BrowserWindow, ipcMain } from 'electron';
import { IPC } from '@chamber/shared';
import type { DesktopUpdateState } from '@chamber/shared/types';
import type { UpdaterService } from '../updater/UpdaterService';

function broadcastState(state: DesktopUpdateState): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.UPDATER.STATE_CHANGED, state);
  }
}

export function setupUpdaterIPC(updaterService: UpdaterService): void {
  ipcMain.handle(IPC.UPDATER.GET_STATE, () => updaterService.getState());
  ipcMain.handle(IPC.UPDATER.CHECK, () => updaterService.checkForUpdates('web-ui'));
  ipcMain.handle(IPC.UPDATER.DOWNLOAD, () => updaterService.downloadUpdate());
  ipcMain.handle(IPC.UPDATER.INSTALL_AND_RESTART, () => updaterService.installAndRestart());

  updaterService.onStateChanged((state) => {
    broadcastState(state);
  });
}
