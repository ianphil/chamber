// Mind IPC handlers — thin adapters for MindManager
import { ipcMain, dialog, BrowserWindow } from 'electron';
import * as path from 'path';
import * as os from 'os';
import type { MindManager } from '../services/mind';
import { withValidation } from './withValidation';
import {
  MindAddArgs,
  MindListArgs,
  MindOpenWindowArgs,
  MindRemoveArgs,
  MindSelectDirectoryArgs,
  MindSetActiveArgs,
} from '../../contracts/mind';

export interface MindIPCConfig {
  preloadPath: string;
  devServerUrl?: string;
  rendererPath?: string;
}

export function setupMindIPC(mindManager: MindManager, config: MindIPCConfig): void {
  ipcMain.handle(
    'mind:add',
    withValidation('mind:add', MindAddArgs, async (_event, mindPath) => {
      return mindManager.loadMind(mindPath);
    }),
  );

  ipcMain.handle(
    'mind:remove',
    withValidation('mind:remove', MindRemoveArgs, async (_event, mindId) => {
      await mindManager.unloadMind(mindId);
    }),
  );

  ipcMain.handle(
    'mind:list',
    withValidation('mind:list', MindListArgs, async () => {
      await mindManager.awaitRestore();
      return mindManager.listMinds();
    }),
  );

  ipcMain.handle(
    'mind:setActive',
    withValidation('mind:setActive', MindSetActiveArgs, async (_event, mindId) => {
      mindManager.setActiveMind(mindId);
    }),
  );

  ipcMain.handle(
    'mind:selectDirectory',
    withValidation(
      'mind:selectDirectory',
      MindSelectDirectoryArgs,
      async (event: Electron.IpcMainInvokeEvent) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!win) return null;

        const result = await dialog.showOpenDialog(win, {
          properties: ['openDirectory'],
          title: 'Select Genesis Mind Directory',
          defaultPath: path.join(os.homedir(), 'agents'),
        });

        if (result.canceled || result.filePaths.length === 0) return null;
        return result.filePaths[0];
      },
    ),
  );

  ipcMain.handle(
    'mind:openWindow',
    withValidation('mind:openWindow', MindOpenWindowArgs, async (_event, mindId) => {
      const existing = mindManager.getWindow(mindId);
      if (existing) {
        existing.focus();
        return;
      }

      const mind = mindManager.getMind(mindId);
      if (!mind) return;

      const win = new BrowserWindow({
        width: 900,
        height: 700,
        minWidth: 500,
        minHeight: 400,
        title: `${mind.identity.name} — Chamber`,
        titleBarStyle: 'hiddenInset',
        titleBarOverlay:
          process.platform === 'win32'
            ? {
                color: '#09090b',
                symbolColor: '#fafafa',
                height: 36,
              }
            : undefined,
        backgroundColor: '#09090b',
        webPreferences: {
          preload: config.preloadPath,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
        },
      });

      if (config.devServerUrl) {
        win.loadURL(`${config.devServerUrl}?mindId=${mindId}&popout=true`);
      } else if (config.rendererPath) {
        win.loadFile(config.rendererPath, { query: { mindId, popout: 'true' } });
      }

      mindManager.attachWindow(mindId, win);

      for (const w of BrowserWindow.getAllWindows()) {
        w.webContents.send('mind:changed', mindManager.listMinds());
      }
    }),
  );

  const broadcastMinds = () => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('mind:changed', mindManager.listMinds());
      }
    }
  };

  mindManager.on('mind:loaded', broadcastMinds);
  mindManager.on('mind:unloaded', broadcastMinds);
  mindManager.on('mind:windowed', broadcastMinds);
  mindManager.on('mind:unwindowed', broadcastMinds);
}
