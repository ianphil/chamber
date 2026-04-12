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
    // Wait for restore to complete before returning the list
    if ((mindManager as any)._restorePromise) {
      await (mindManager as any)._restorePromise;
    }
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

  // Backward compat: renderer still calls agent:getStatus during startup
  ipcMain.handle('agent:getStatus', async () => {
    const minds = mindManager.listMinds();
    const active = minds.find(m => m.mindId === mindManager.getActiveMindId()) ?? minds[0];
    return {
      connected: minds.length > 0,
      mindPath: active?.mindPath ?? null,
      agentName: active?.identity.name ?? null,
      sessionActive: minds.length > 0,
      uptime: null,
      error: null,
      extensions: [],
    };
  });

  // Backward compat: renderer calls agent:selectMindDirectory
  ipcMain.handle('agent:selectMindDirectory', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;

    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Select Genesis Mind Directory',
      defaultPath: path.join(os.homedir(), 'agents'),
    });

    if (result.canceled || result.filePaths.length === 0) return null;
    const selected = result.filePaths[0];

    try {
      const mind = await mindManager.loadMind(selected);
      mindManager.setActiveMind(mind.mindId);
      return selected;
    } catch {
      return null;
    }
  });

  // Backward compat: renderer calls agent:setMindPath
  ipcMain.handle('agent:setMindPath', async (_event, mindPath: string) => {
    try {
      const mind = await mindManager.loadMind(mindPath);
      mindManager.setActiveMind(mind.mindId);
    } catch { /* ignore */ }
  });

  // Backward compat: config load/save
  ipcMain.handle('config:load', async () => {
    const minds = mindManager.listMinds();
    const active = mindManager.getActiveMindId();
    return {
      version: 2,
      minds: minds.map(m => ({ id: m.mindId, path: m.mindPath })),
      activeMindId: active,
      theme: 'dark',
    };
  });

  ipcMain.handle('config:save', async () => {
    // No-op — MindManager persists config internally
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
