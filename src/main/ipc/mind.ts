// Mind IPC adapter — bridges ipcMain to the Dispatcher.
//
// Some mind:* channels are electron-only (mind:selectDirectory uses dialog,
// mind:openWindow creates a BrowserWindow). Those register on the
// dispatcher for uniformity but WS callers get -32601; see
// src/main/rpc/channelClassification.ts.
import { ipcMain, dialog, BrowserWindow } from 'electron';
import * as path from 'path';
import * as os from 'os';
import type { MindManager } from '../services/mind';
import type { Dispatcher } from '../rpc/dispatcher';
import type { PushBus } from '../rpc/pushBus';
import { makeIpcBridge } from './bridge';
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

const MIND_CHANNELS = [
  'mind:add',
  'mind:remove',
  'mind:list',
  'mind:setActive',
  'mind:selectDirectory',
  'mind:openWindow',
] as const;

export function setupMindIPC(
  dispatcher: Dispatcher,
  pushBus: PushBus,
  mindManager: MindManager,
  config: MindIPCConfig,
): void {
  // --- Portable handlers ------------------------------------------------
  dispatcher.register('mind:add', MindAddArgs, async ([mindPath]) => {
    return mindManager.loadMind(mindPath);
  });

  dispatcher.register('mind:remove', MindRemoveArgs, async ([mindId]) => {
    await mindManager.unloadMind(mindId);
  });

  dispatcher.register('mind:list', MindListArgs, async () => {
    await mindManager.awaitRestore();
    return mindManager.listMinds();
  });

  dispatcher.register('mind:setActive', MindSetActiveArgs, async ([mindId]) => {
    mindManager.setActiveMind(mindId);
  });

  // --- Electron-only handlers (WS callers get -32601) --------------------
  dispatcher.register('mind:selectDirectory', MindSelectDirectoryArgs, async (_args, ctx) => {
    const sender = ctx.senderHandle as Electron.WebContents;
    const win = BrowserWindow.fromWebContents(sender);
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Select Genesis Mind Directory',
      defaultPath: path.join(os.homedir(), 'agents'),
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  dispatcher.register('mind:openWindow', MindOpenWindowArgs, async ([mindId]) => {
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
          ? { color: '#09090b', symbolColor: '#fafafa', height: 36 }
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
    pushBus.publish('mind:changed', { minds: mindManager.listMinds() });
  });

  // --- IPC bridges + broadcast wiring ------------------------------------
  for (const channel of MIND_CHANNELS) {
    ipcMain.handle(channel, makeIpcBridge(dispatcher, channel));
  }

  const broadcast = () => {
    pushBus.publish('mind:changed', { minds: mindManager.listMinds() });
  };
  mindManager.on('mind:loaded', broadcast);
  mindManager.on('mind:unloaded', broadcast);
  mindManager.on('mind:windowed', broadcast);
  mindManager.on('mind:unwindowed', broadcast);
}
