import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn() },
}));

vi.mock('@chamber/services', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@chamber/services')>();
  return {
    ...actual,
    seedLensDefaults: vi.fn(),
    installLensSkill: vi.fn(),
  };
});

import { ipcMain, BrowserWindow } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { setupGenesisIPC } from './genesis';
import type { GenesisMindTemplate, MindManager, MindScaffold } from '@chamber/services';

type InvokeHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

const EVT = { sender: {} } as IpcMainInvokeEvent;

const lucyTemplate: GenesisMindTemplate = {
  id: 'lucy',
  displayName: 'Lucy',
  description: 'A calm Chief of Staff mind.',
  role: 'Chief of Staff',
  voice: 'Vanilla, calm, helpful, and precise',
  templateVersion: '0.1.0',
  agent: '.github/agents/lucy.agent.md',
  requiredFiles: ['SOUL.md'],
  source: {
    owner: 'ianphil',
    repo: 'genesis-minds',
    ref: 'master',
    plugin: 'genesis-minds',
    manifestPath: 'plugins/genesis-minds/minds/lucy/mind.json',
    rootPath: 'plugins/genesis-minds/minds/lucy',
  },
};

describe('setupGenesisIPC', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue({ webContents: { send: vi.fn() } } as never);
  });

  it('registers template listing and install handlers', () => {
    setupGenesisIPC(createMindManager(), createScaffold(), createCatalog(), createInstaller());

    const channels = vi.mocked(ipcMain.handle).mock.calls.map((call) => call[0]);

    expect(channels).toContain('genesis:listTemplates');
    expect(channels).toContain('genesis:createFromTemplate');
  });

  it('lists predefined templates from the catalog', async () => {
    const catalog = createCatalog();
    setupGenesisIPC(createMindManager(), createScaffold(), catalog, createInstaller());

    await expect(getHandler('genesis:listTemplates')(EVT)).resolves.toEqual([lucyTemplate]);
    expect(catalog.listTemplates).toHaveBeenCalled();
  });

  it('installs a predefined template and activates the loaded mind', async () => {
    const mindManager = createMindManager();
    const installer = createInstaller();
    const mockSend = vi.fn();
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue({ webContents: { send: mockSend } } as never);
    setupGenesisIPC(mindManager, createScaffold(), createCatalog(), installer);

    await expect(getHandler('genesis:createFromTemplate')(EVT, { templateId: 'lucy', basePath: 'C:\\agents' })).resolves.toEqual({
      success: true,
      mindId: 'lucy-1234',
      mindPath: 'C:\\agents\\lucy',
    });

    expect(installer.install).toHaveBeenCalledWith({ templateId: 'lucy', basePath: 'C:\\agents' });
    expect(mindManager.loadMind).toHaveBeenCalledWith('C:\\agents\\lucy');
    expect(mindManager.setActiveMind).toHaveBeenCalledWith('lucy-1234');
    expect(mockSend).toHaveBeenCalledWith('genesis:progress', { step: 'complete', detail: 'Genesis template install complete.' });
  });

  it('returns a clear error when predefined template install fails without generating a custom mind', async () => {
    const scaffold = createScaffold();
    const installer = createInstaller();
    installer.install.mockRejectedValue(new Error('marketplace unavailable'));
    setupGenesisIPC(createMindManager(), scaffold, createCatalog(), installer);

    await expect(getHandler('genesis:createFromTemplate')(EVT, { templateId: 'lucy', basePath: 'C:\\agents' })).resolves.toEqual({
      success: false,
      error: 'marketplace unavailable',
    });

    expect(scaffold.create).not.toHaveBeenCalled();
  });
});

function getHandler(name: string): InvokeHandler {
  const call = vi.mocked(ipcMain.handle).mock.calls.find((item) => item[0] === name);
  if (!call) throw new Error(`no handler registered for ${name}`);
  return call[1] as InvokeHandler;
}

function createMindManager(): MindManager & {
  loadMind: ReturnType<typeof vi.fn>;
  setActiveMind: ReturnType<typeof vi.fn>;
} {
  return {
    loadMind: vi.fn().mockResolvedValue({ mindId: 'lucy-1234' }),
    setActiveMind: vi.fn(),
  } as unknown as MindManager & { loadMind: ReturnType<typeof vi.fn>; setActiveMind: ReturnType<typeof vi.fn> };
}

function createScaffold(): MindScaffold & {
  create: ReturnType<typeof vi.fn>;
  setProgressHandler: ReturnType<typeof vi.fn>;
} {
  return {
    create: vi.fn(),
    setProgressHandler: vi.fn(),
  } as unknown as MindScaffold & { create: ReturnType<typeof vi.fn>; setProgressHandler: ReturnType<typeof vi.fn> };
}

function createCatalog() {
  return {
    listTemplates: vi.fn(() => [lucyTemplate]),
  };
}

function createInstaller() {
  return {
    install: vi.fn().mockResolvedValue('C:\\agents\\lucy'),
  };
}
