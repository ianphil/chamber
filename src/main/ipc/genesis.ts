// Genesis IPC handlers — wire MindScaffold to renderer
import { ipcMain, dialog, BrowserWindow } from 'electron';
import { MindScaffold, type GenesisConfig } from '../services/genesis';
import type { MindManager } from '../services/mind/MindManager';
import { seedLensDefaults, installLensSkill } from '../services/lens';

export function setupGenesisIPC(
  mindManager: MindManager,
  scaffold: MindScaffold,
): void {

  ipcMain.handle('genesis:getDefaultPath', async () => {
    return MindScaffold.getDefaultBasePath();
  });

  ipcMain.handle('genesis:pickPath', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;

    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose where to create your agent',
      defaultPath: MindScaffold.getDefaultBasePath(),
    });

    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('genesis:create', async (event, config: GenesisConfig) => {
    const win = BrowserWindow.fromWebContents(event.sender);

    scaffold.setProgressHandler((progress) => {
      if (win) win.webContents.send('genesis:progress', progress);
    });

    try {
      const mindPath = await scaffold.create(config);

      // Bootstrap Lens defaults
      seedLensDefaults(mindPath);
      installLensSkill(mindPath);

      // Load into MindManager (creates client, session, scans views)
      const mind = await mindManager.loadMind(mindPath);
      mindManager.setActiveMind(mind.mindId);

      return { success: true, mindPath };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (win) win.webContents.send('genesis:progress', { step: 'error', detail: message });
      return { success: false, error: message };
    }
  });
}
