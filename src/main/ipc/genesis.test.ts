import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn().mockReturnValue(null) },
}));

import { ipcMain } from 'electron';
import { setupGenesisIPC } from './genesis';
import { IpcValidationError } from '../../contracts/errors';
import type { MindManager } from '../services/mind';
import type { MindScaffold } from '../services/genesis';
import { Dispatcher } from '../rpc/dispatcher';

function fakeMindManager() {
  return {
    loadMind: vi.fn().mockResolvedValue({ mindId: 'm1' }),
    setActiveMind: vi.fn(),
  } as unknown as MindManager;
}

function fakeScaffold() {
  return {
    create: vi.fn().mockResolvedValue('/tmp/agents/aria'),
    setProgressHandler: vi.fn(),
  } as unknown as MindScaffold;
}

function getHandler(channel: string): (event: unknown, ...args: unknown[]) => unknown {
  const call = vi.mocked(ipcMain.handle).mock.calls.find((c) => c[0] === channel);
  if (!call) throw new Error(`handler not registered: ${channel}`);
  return call[1] as (event: unknown, ...args: unknown[]) => unknown;
}

describe('setupGenesisIPC — validation', () => {
  beforeEach(() => vi.mocked(ipcMain.handle).mockClear());

  it('registers all genesis handlers', () => {
    setupGenesisIPC(new Dispatcher(), fakeMindManager(), fakeScaffold());
    const channels = vi.mocked(ipcMain.handle).mock.calls.map((c) => c[0]);
    expect(channels).toEqual(
      expect.arrayContaining(['genesis:getDefaultPath', 'genesis:pickPath', 'genesis:create']),
    );
  });

  it('genesis:create rejects missing config', async () => {
    setupGenesisIPC(new Dispatcher(), fakeMindManager(), fakeScaffold());
    await expect(getHandler('genesis:create')({ sender: {} })).rejects.toBeInstanceOf(
      IpcValidationError,
    );
  });

  it('genesis:create rejects incomplete config', async () => {
    setupGenesisIPC(new Dispatcher(), fakeMindManager(), fakeScaffold());
    await expect(
      getHandler('genesis:create')({ sender: {} }, { name: 'A' }),
    ).rejects.toBeInstanceOf(IpcValidationError);
  });

  it('genesis:create succeeds with valid config', async () => {
    const mgr = fakeMindManager();
    const scaffold = fakeScaffold();
    setupGenesisIPC(new Dispatcher(), mgr, scaffold);
    const result = await getHandler('genesis:create')({ sender: {} }, {
      name: 'Aria',
      role: 'assist',
      voice: 'warm',
      voiceDescription: 'desc',
      basePath: '/tmp',
    });
    expect(result).toEqual({ success: true, mindPath: '/tmp/agents/aria' });
    expect(scaffold.create).toHaveBeenCalled();
  });

  it('genesis:getDefaultPath accepts no args', async () => {
    setupGenesisIPC(new Dispatcher(), fakeMindManager(), fakeScaffold());
    await expect(getHandler('genesis:getDefaultPath')({ sender: {} })).resolves.toBeTypeOf('string');
  });
});
