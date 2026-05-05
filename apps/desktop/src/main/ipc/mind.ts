// Mind IPC handlers — thin adapters for MindManager
import { ipcMain, dialog, BrowserWindow, type NativeImage } from 'electron';
import * as path from 'path';
import * as os from 'os';
import type { MindManager } from '@chamber/services';
import type { MindContext } from '@chamber/shared/types';
import { installExternalNavigationGuard } from '../navigationGuard';

export interface MindIPCConfig {
  preloadPath: string;
  devServerUrl?: string;
  rendererPath?: string;
  windowIcon?: NativeImage;
}

export function setupMindIPC(mindManager: MindManager, config: MindIPCConfig): void {
  const windowByMind = new Map<string, BrowserWindow>();
  const listMinds = (): MindContext[] =>
    mindManager.listMinds().map((mind) => ({
      ...mind,
      windowed: windowByMind.has(mind.mindId),
    }));

  ipcMain.handle('mind:add', async (event, mindPath: string) => {
    return mindManager.loadMind(mindPath);
  });

  ipcMain.handle('mind:remove', async (_event, mindId: string) => {
    await mindManager.unloadMind(mindId);
  });

  ipcMain.handle('mind:list', async () => {
    // Wait for restore to complete before returning the list
    await mindManager.awaitRestore();
    return listMinds();
  });

  ipcMain.handle('mind:setActive', async (_event, mindId: string) => {
    mindManager.setActiveMind(mindId);
  });

  ipcMain.handle('mind:setModel', async (_event, mindId: string, model: string | null) => {
    return mindManager.setMindModel(mindId, model);
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

  ipcMain.handle('mind:openWindow', async (_event, mindId: string) => {
    // If already popped out, focus existing window
    const existing = windowByMind.get(mindId);
    if (existing) {
      existing.focus();
      return;
    }

    // Verify mind exists
    const mind = mindManager.getMind(mindId);
    if (!mind) return;

    // Create popout window
    const win = new BrowserWindow({
      width: 900,
      height: 700,
      minWidth: 500,
      minHeight: 400,
      title: `${mind.identity.name} — Chamber`,
      titleBarStyle: 'hiddenInset',
      titleBarOverlay: process.platform === 'win32' ? {
        color: '#09090b',
        symbolColor: '#fafafa',
        height: 36,
      } : undefined,
      icon: config.windowIcon,
      backgroundColor: '#09090b',
      webPreferences: {
        preload: config.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    installExternalNavigationGuard(win.webContents);

    // Load same renderer with popout query params
    if (config.devServerUrl) {
      win.loadURL(`${config.devServerUrl}?mindId=${mindId}&popout=true`);
    } else if (config.rendererPath) {
      win.loadFile(config.rendererPath, { query: { mindId, popout: 'true' } });
    }

    windowByMind.set(mindId, win);
    win.on('closed', () => {
      windowByMind.delete(mindId);
      broadcastMinds();
    });

    // Notify all windows about the state change
    broadcastMinds();
  });

  // Emit mind changes to all windows
  const broadcastMinds = () => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
      win.webContents.send('mind:changed', listMinds());
      }
    }
  };

  mindManager.on('mind:loaded', broadcastMinds);
  mindManager.on('mind:unloaded', (mindId: string) => {
    const existing = windowByMind.get(mindId);
    windowByMind.delete(mindId);
    existing?.close();
    broadcastMinds();
  });
}
