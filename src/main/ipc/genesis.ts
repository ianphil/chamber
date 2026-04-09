// Genesis IPC handlers — wire MindScaffold to renderer
import { ipcMain, dialog, BrowserWindow } from 'electron';
import { MindScaffold, type GenesisConfig } from '../services/MindScaffold';
import { ChatService } from '../services/ChatService';
import { ViewDiscovery } from '../services/ViewDiscovery';

export function setupGenesisIPC(
  chatService: ChatService,
  viewDiscovery: ViewDiscovery,
): void {
  const scaffold = new MindScaffold();

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

    // Send progress updates to renderer
    scaffold.setProgressHandler((progress) => {
      if (win) {
        win.webContents.send('genesis:progress', progress);
      }
    });

    try {
      const mindPath = await scaffold.create(config);

      // Connect the new mind
      chatService.setMindPath(mindPath);
      await viewDiscovery.scan(mindPath);
      viewDiscovery.startWatching(() => {
        if (win) {
          win.webContents.send('lens:viewsChanged', viewDiscovery.getViews());
        }
      });

      // Save config
      const { saveConfig, loadConfig } = await import('./agent');
      const appConfig = loadConfig();
      appConfig.mindPath = mindPath;
      saveConfig(appConfig);

      return { success: true, mindPath };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  });
}
