// Agent IPC handlers — status, mind directory, config
import { ipcMain, dialog, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ChatService } from '../services/ChatService';
import { ViewDiscovery } from '../services/ViewDiscovery';
import type { AgentStatus, AppConfig } from '../../shared/types';

const CONFIG_DIR = path.join(os.homedir(), '.chamber');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

export function loadConfig(): AppConfig {
  try {
    const data = fs.readFileSync(CONFIG_PATH, 'utf-8');
    return JSON.parse(data);
  } catch {
    return { mindPath: null, theme: 'dark' };
  }
}

export function saveConfig(config: AppConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export function setupAgentIPC(chatService: ChatService, viewDiscovery: ViewDiscovery): void {
  ipcMain.handle('agent:getStatus', async (): Promise<AgentStatus> => {
    const mindPath = chatService.getMindPath();
    const loader = chatService.getExtensionLoader();
    let agentName: string | null = null;

    if (mindPath) {
      try {
        const soulPath = path.join(mindPath, 'SOUL.md');
        if (fs.existsSync(soulPath)) {
          const soul = fs.readFileSync(soulPath, 'utf-8');
          const match = soul.match(/^#\s+(.+)/m);
          if (match) agentName = match[1].trim();
        }
      } catch { /* ignore */ }
      if (!agentName) {
        agentName = mindPath.split(/[\\/]/).pop() ?? null;
      }
    }

    return {
      connected: mindPath !== null,
      mindPath,
      agentName,
      sessionActive: mindPath !== null,
      uptime: null,
      error: null,
      extensions: loader ? loader.getLoadedExtensions() : [],
    };
  });

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
    // Validate it's a Genesis mind (has SOUL.md or .github/)
    const hasSoul = fs.existsSync(path.join(selected, 'SOUL.md'));
    const hasGithub = fs.existsSync(path.join(selected, '.github'));

    if (!hasSoul && !hasGithub) {
      return null; // Not a valid mind directory
    }

    chatService.setMindPath(selected);
    const config = loadConfig();
    config.mindPath = selected;
    saveConfig(config);

    // Scan for Lens views and start watching
    const views = await viewDiscovery.scan(selected);
    viewDiscovery.startWatching(() => {
      const win2 = BrowserWindow.getAllWindows()[0];
      if (win2) {
        win2.webContents.send('lens:viewsChanged', viewDiscovery.getViews());
      }
    });

    return selected;
  });

  ipcMain.handle('agent:setMindPath', async (_event, mindPath: string) => {
    chatService.setMindPath(mindPath);
    const config = loadConfig();
    config.mindPath = mindPath;
    saveConfig(config);
  });

  ipcMain.handle('config:load', async (): Promise<AppConfig> => {
    return loadConfig();
  });

  ipcMain.handle('config:save', async (_event, config: AppConfig) => {
    saveConfig(config);
  });
}

/** Restore persisted mind path on startup */
export function restoreConfig(chatService: ChatService, viewDiscovery?: ViewDiscovery): void {
  const config = loadConfig();
  if (config.mindPath && fs.existsSync(config.mindPath)) {
    chatService.setMindPath(config.mindPath);
    if (viewDiscovery) {
      viewDiscovery.scan(config.mindPath).then(() => {
        viewDiscovery.startWatching(() => {
          const win = BrowserWindow.getAllWindows()[0];
          if (win) {
            win.webContents.send('lens:viewsChanged', viewDiscovery.getViews());
          }
        });
      });
    }
  }
}
