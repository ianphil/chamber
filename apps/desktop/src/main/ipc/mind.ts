// Mind IPC handlers — thin adapters for MindManager
import { ipcMain, dialog, BrowserWindow, type NativeImage } from 'electron';
import * as path from 'path';
import * as os from 'os';
import { setTimeout as delay } from 'node:timers/promises';
import { IPC } from '@chamber/shared';
import type { ChatService, MindManager } from '@chamber/services';
import { Logger } from '@chamber/services';
import type { MindContext } from '@chamber/shared/types';
import { installExternalNavigationGuard } from '../navigationGuard';

const log = Logger.create('mind-ipc');

export interface MindIPCConfig {
  preloadPath: string;
  devServerUrl?: string;
  rendererPath?: string;
  windowIcon?: NativeImage;
  // Returns the current value of the `dreamDaemon` app feature flag. When this
  // returns false, `IPC.MIND.SET_DREAM_DAEMON` rejects with a "feature
  // unavailable" Error rather than calling into MindManager. The renderer's
  // typed contract is `Promise<MindContext>` (not a result union), so a thrown
  // Error surfaces through the caller's `await … catch` path. Defaults to
  // always-on so test harnesses that omit it keep the existing contract.
  dreamDaemonEnabled?: () => boolean;
}

export function setupMindIPC(mindManager: MindManager, chatService: ChatService, config: MindIPCConfig): void {
  const dreamDaemonEnabled = config.dreamDaemonEnabled ?? (() => true);
  const windowByMind = new Map<string, BrowserWindow>();
  const listMinds = (): MindContext[] =>
    mindManager.listMinds().map((mind) => ({
      ...mind,
      windowed: windowByMind.has(mind.mindId),
    }));

  ipcMain.handle(IPC.MIND.ADD, async (event, mindPath: string) => {
    // Issue #44 — surface duplicate display-name collisions at add-time
    // instead of leaving two minds with the same UI label.
    try {
      return await mindManager.loadMind(mindPath, undefined, { enforceUnique: true });
    } catch (error) {
      log.error(`mind:add failed for ${mindPath}:`, error);
      throw error;
    }
  });

  ipcMain.handle(IPC.MIND.REMOVE, async (_event, mindId: string) => {
    await mindManager.unloadMind(mindId);
  });

  ipcMain.handle(IPC.MIND.LIST, async () => {
    // Wait for restore to complete before returning the list
    await mindManager.awaitRestore();
    return listMinds();
  });

  ipcMain.handle(IPC.MIND.SET_ACTIVE, async (_event, mindId: string) => {
    mindManager.setActiveMind(mindId);
  });

  ipcMain.handle(IPC.MIND.SET_MODEL, async (_event, mindId: string, model: string | null) => {
    const e2eDelayMs = Number(process.env.CHAMBER_E2E_MODEL_SWITCH_DELAY_MS ?? 0);
    if (e2eDelayMs > 0) await delay(e2eDelayMs);
    return chatService.setMindModel(mindId, model);
  });

  ipcMain.handle(IPC.MIND.SET_DREAM_DAEMON, async (_event, mindId: string, enabled: boolean) => {
    // Authoritative gate at the IPC boundary. When the app-level `dreamDaemon`
    // feature flag is off, the renderer must not be able to *enable* the
    // per-mind opt-in via this channel — that would activate consolidation in
    // a build that disables the feature. The *disable* direction stays
    // available so a future stable build that re-introduces a "clean up legacy
    // state" path can route through this channel without a special case.
    // The rejection surfaces via the renderer's `await … catch` path. See
    // AgentProfileModal for the consuming UI.
    if (enabled && !dreamDaemonEnabled()) {
      throw new Error('Dream Daemon is not available in this build');
    }
    return enabled
      ? mindManager.enableDreamDaemon(mindId)
      : mindManager.disableDreamDaemon(mindId);
  });

  ipcMain.handle(IPC.MIND.SELECT_DIRECTORY, async (event) => {
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

  ipcMain.handle(IPC.MIND.OPEN_WINDOW, async (_event, mindId: string) => {
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
      win.webContents.send(IPC.MIND.CHANGED, listMinds());
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
