// Mind IPC handlers — thin adapters for MindManager
import { ipcMain, dialog, BrowserWindow } from 'electron';
import * as path from 'path';
import * as os from 'os';
import type { MindManager } from '../services/mind/MindManager';

export function setupMindIPC(mindManager: MindManager): void {
  ipcMain.handle('mind:add', async (event, mindPath: string) => {
    return mindManager.loadMind(mindPath);
  });

  ipcMain.handle('mind:remove', async (_event, mindId: string) => {
    await mindManager.unloadMind(mindId);
  });

  ipcMain.handle('mind:list', async () => {
    return mindManager.listMinds();
  });

  ipcMain.handle('mind:setActive', async (_event, mindId: string) => {
    mindManager.setActiveMind(mindId);
  });

  ipcMain.handle('mind:selectDirectory', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;

    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Select Genesis Mind Directory',
      defaultPath: path.join(os.homedir(), 'agents'),
    });

    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // Emit mind changes to all windows
  mindManager.on('mind:loaded', () => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('mind:changed', mindManager.listMinds());
    }
  });

  mindManager.on('mind:unloaded', () => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('mind:changed', mindManager.listMinds());
    }
  });
}
