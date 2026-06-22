// Genesis IPC handlers — wire MindScaffold to renderer
import { ipcMain, dialog, BrowserWindow } from 'electron';
import { getErrorMessage } from '@chamber/shared/getErrorMessage';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { IPC, parseIpcArgs } from '@chamber/shared';
import {
  MindManager,
  MindScaffold,
  bootstrapMindCapabilities,
  seedOnboardingDocument,
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

const createFromTemplateSchema = z
  .object({
    templateId: z.string().min(1, 'must be a non-empty string'),
    marketplaceId: z.string().min(1, 'must be a non-empty string when provided').optional(),
    basePath: z.string().min(1, 'must be a non-empty string'),
  })
  .strict();

const seedDocumentSchema = z
  .object({
    mindId: z.string().min(1, 'must be a non-empty string'),
    content: z.string().min(1, 'must be a non-empty string'),
  })
  .strict();

export function setupGenesisIPC(
  mindManager: MindManager,
  scaffold: MindScaffold,
  templateCatalog: GenesisMindTemplateCatalogPort,
  templateInstaller: GenesisMindTemplateInstallerPort,
): void {

  ipcMain.handle(IPC.GENESIS.GET_DEFAULT_PATH, async () => {
    return getDefaultGenesisBasePath();
  });

  ipcMain.handle(IPC.GENESIS.PICK_PATH, async (event) => {
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

  ipcMain.handle(IPC.GENESIS.LIST_TEMPLATES, async () => {
    return await templateCatalog.listTemplates();
  });

  ipcMain.handle(IPC.GENESIS.CREATE, async (event, config: GenesisConfig) => {
    const win = BrowserWindow.fromWebContents(event.sender);

    // Issue #44 — detect name collision BEFORE scaffolding so we never
    // create a directory the user can't activate. The check is
    // case-insensitive against currently-loaded minds; persisted-but-not-
    // loaded minds are not considered.
    const collision = mindManager.findByName(config.name);
    if (collision) {
      const message = `An agent named "${config.name}" already exists. Choose a different name.`;
      if (win) win.webContents.send(IPC.GENESIS.PROGRESS, { step: 'error', detail: message });
      return { success: false, error: message };
    }

    scaffold.setProgressHandler((progress) => {
      if (win) win.webContents.send(IPC.GENESIS.PROGRESS, progress);
    });

    try {
      const mindPath = await scaffold.create(config);
      return await activateCreatedMind(mindManager, mindPath);
    } catch (err) {
      const message = getErrorMessage(err);
      if (win) win.webContents.send(IPC.GENESIS.PROGRESS, { step: 'error', detail: message });
      return { success: false, error: message };
    }
  });

  ipcMain.handle(IPC.GENESIS.CREATE_FROM_TEMPLATE, async (event, rawRequest: unknown) => {
    const request = parseIpcArgs(IPC.GENESIS.CREATE_FROM_TEMPLATE, createFromTemplateSchema, rawRequest);
    const win = BrowserWindow.fromWebContents(event.sender);

    try {
      if (win) win.webContents.send(IPC.GENESIS.PROGRESS, { step: 'template', detail: 'Installing Genesis mind template...' });
      const mindPath = await templateInstaller.install(request);
      const result = await activateCreatedMind(mindManager, mindPath);
      if (win) win.webContents.send(IPC.GENESIS.PROGRESS, { step: 'complete', detail: 'Genesis template install complete.' });
      return result;
    } catch (err) {
      const message = getErrorMessage(err);
      if (win) win.webContents.send(IPC.GENESIS.PROGRESS, { step: 'error', detail: message });
      return { success: false, error: message };
    }
  });

  // Seed an onboarding document into a created mind. The destination path is
  // owned by Chamber (see seedOnboardingDocument); the renderer supplies only
  // the mind id and content.
  ipcMain.handle(IPC.GENESIS.SEED_DOCUMENT, async (_event, rawArgs: unknown) => {
    const { mindId, content } = parseIpcArgs(IPC.GENESIS.SEED_DOCUMENT, seedDocumentSchema, rawArgs);
    const mindPath = mindManager.getMind(mindId)?.mindPath;
    if (!mindPath) {
      return { success: false, error: `Mind ${mindId} not found` };
    }
    try {
      seedOnboardingDocument(mindPath, content);
      return { success: true };
    } catch (err) {
      return { success: false, error: getErrorMessage(err) };
    }
  });
}

async function activateCreatedMind(mindManager: MindManager, mindPath: string): Promise<{ success: true; mindId: string; mindPath: string } | { success: false; error: string }> {
  appendE2EGenesisMemory(mindPath);
  bootstrapMindCapabilities(mindPath);

  try {
    // Defense in depth — between the IPC pre-check (in IPC.GENESIS.CREATE)
    // and this load, a concurrent mind:add or genesis:create_from_template
    // could land a colliding mind. Also covers the template-install path
    // which has no pre-check of its own.
    const mind = await mindManager.loadMind(mindPath, undefined, { enforceUnique: true });
    mindManager.setActiveMind(mind.mindId);
    return { success: true, mindId: mind.mindId, mindPath };
  } catch (err) {
    const message = getErrorMessage(err);
    return { success: false, error: message };
  }
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
