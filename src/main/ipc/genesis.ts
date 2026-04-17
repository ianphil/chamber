// Genesis IPC adapter — bridges ipcMain to the Dispatcher.
// genesis:pickPath is electron-only (uses dialog).
import { ipcMain, dialog, BrowserWindow } from 'electron';
import { MindScaffold } from '../services/genesis';
import type { MindManager } from '../services/mind';
import { seedLensDefaults, installLensSkill } from '../services/lens';
import type { Dispatcher } from '../rpc/dispatcher';
import { makeIpcBridge } from './bridge';
import {
  GenesisCreateArgs,
  GenesisGetDefaultPathArgs,
  GenesisPickPathArgs,
} from '../../contracts/genesis';

const GENESIS_CHANNELS = ['genesis:getDefaultPath', 'genesis:pickPath', 'genesis:create'] as const;

export function setupGenesisIPC(
  dispatcher: Dispatcher,
  mindManager: MindManager,
  scaffold: MindScaffold,
): void {
  dispatcher.register('genesis:getDefaultPath', GenesisGetDefaultPathArgs, async () => {
    return MindScaffold.getDefaultBasePath();
  });

  dispatcher.register('genesis:pickPath', GenesisPickPathArgs, async (_args, ctx) => {
    const sender = ctx.senderHandle as Electron.WebContents;
    const win = BrowserWindow.fromWebContents(sender);
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose where to create your agent',
      defaultPath: MindScaffold.getDefaultBasePath(),
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  dispatcher.register('genesis:create', GenesisCreateArgs, async ([config], ctx) => {
    scaffold.setProgressHandler((progress) => {
      ctx.reply.emit('genesis:progress', progress);
    });

    try {
      const mindPath = await scaffold.create(config);
      seedLensDefaults(mindPath);
      installLensSkill(mindPath);
      const mind = await mindManager.loadMind(mindPath);
      mindManager.setActiveMind(mind.mindId);
      return { success: true, mindPath };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.reply.emit('genesis:progress', { step: 'error', detail: message });
      return { success: false, error: message };
    }
  });

  for (const channel of GENESIS_CHANNELS) {
    ipcMain.handle(channel, makeIpcBridge(dispatcher, channel));
  }
}
