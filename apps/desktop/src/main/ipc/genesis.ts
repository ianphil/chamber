// Genesis IPC handlers — wire MindScaffold to renderer
import { ipcMain, dialog, BrowserWindow } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  MindManager,
  MindScaffold,
  installLensSkill,
  seedLensDefaults,
  type GenesisConfig,
  type GenesisMindTemplate,
  type GenesisMindTemplateInstallRequest,
} from '@chamber/services';

interface GenesisMindTemplateCatalogPort {
  listTemplates(): Promise<GenesisMindTemplate[]>;
}

interface GenesisMindTemplateInstallerPort {
  install(request: GenesisMindTemplateInstallRequest): Promise<string>;
}

export function setupGenesisIPC(
  mindManager: MindManager,
  scaffold: MindScaffold,
  templateCatalog: GenesisMindTemplateCatalogPort,
  templateInstaller: GenesisMindTemplateInstallerPort,
): void {

  ipcMain.handle('genesis:getDefaultPath', async () => {
    return getDefaultGenesisBasePath();
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

  ipcMain.handle('genesis:listTemplates', async () => {
    return await templateCatalog.listTemplates();
  });

  ipcMain.handle('genesis:create', async (event, config: GenesisConfig) => {
    const win = BrowserWindow.fromWebContents(event.sender);

    scaffold.setProgressHandler((progress) => {
      if (win) win.webContents.send('genesis:progress', progress);
    });

    try {
      const mindPath = await scaffold.create(config);
      return await activateCreatedMind(mindManager, mindPath);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (win) win.webContents.send('genesis:progress', { step: 'error', detail: message });
      return { success: false, error: message };
    }
  });

  ipcMain.handle('genesis:createFromTemplate', async (event, request: GenesisMindTemplateInstallRequest) => {
    const win = BrowserWindow.fromWebContents(event.sender);

    try {
      if (win) win.webContents.send('genesis:progress', { step: 'template', detail: 'Installing Genesis mind template...' });
      const mindPath = await templateInstaller.install(request);
      const result = await activateCreatedMind(mindManager, mindPath);
      if (win) win.webContents.send('genesis:progress', { step: 'complete', detail: 'Genesis template install complete.' });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (win) win.webContents.send('genesis:progress', { step: 'error', detail: message });
      return { success: false, error: message };
    }
  });
}

async function activateCreatedMind(mindManager: MindManager, mindPath: string): Promise<{ success: true; mindId: string; mindPath: string }> {
  appendE2EGenesisMemory(mindPath);
  seedLensDefaults(mindPath);
  installLensSkill(mindPath);

  const mind = await mindManager.loadMind(mindPath);
  mindManager.setActiveMind(mind.mindId);

  return { success: true, mindId: mind.mindId, mindPath };
}

function getDefaultGenesisBasePath(): string {
  if (process.env.CHAMBER_E2E === '1' && process.env.CHAMBER_E2E_GENESIS_BASE_PATH) {
    return process.env.CHAMBER_E2E_GENESIS_BASE_PATH;
  }
  return MindScaffold.getDefaultBasePath();
}

function appendE2EGenesisMemory(mindPath: string): void {
  const memoryAppend = process.env.CHAMBER_E2E_GENESIS_MEMORY_APPEND?.trim();
  if (process.env.CHAMBER_E2E !== '1' || !memoryAppend) return;

  fs.appendFileSync(path.join(mindPath, '.working-memory', 'memory.md'), `\n\n${memoryAppend}\n`, 'utf-8');
}
