import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
  BrowserWindow: {
    fromWebContents: vi.fn().mockReturnValue(null),
    getAllWindows: vi.fn().mockReturnValue([]),
  },
}));

import { ipcMain } from 'electron';
import { setupMindIPC } from './mind';
import { IpcValidationError } from '../../contracts/errors';
import type { MindManager } from '../services/mind';

function fakeMindManager() {
  return {
    loadMind: vi.fn().mockResolvedValue({ mindId: 'm1' }),
    unloadMind: vi.fn().mockResolvedValue(undefined),
    awaitRestore: vi.fn().mockResolvedValue(undefined),
    listMinds: vi.fn().mockReturnValue([]),
    setActiveMind: vi.fn(),
    getWindow: vi.fn().mockReturnValue(null),
    getMind: vi.fn().mockReturnValue(null),
    attachWindow: vi.fn(),
    on: vi.fn(),
  } as unknown as MindManager;
}

function getHandler(channel: string): (event: unknown, ...args: unknown[]) => unknown {
  const call = vi.mocked(ipcMain.handle).mock.calls.find((c) => c[0] === channel);
  if (!call) throw new Error(`handler not registered: ${channel}`);
  return call[1] as (event: unknown, ...args: unknown[]) => unknown;
}

describe('setupMindIPC — validation', () => {
  beforeEach(() => vi.mocked(ipcMain.handle).mockClear());

  it('registers all mind handlers', () => {
    setupMindIPC(fakeMindManager(), { preloadPath: '/pre' });
    const channels = vi.mocked(ipcMain.handle).mock.calls.map((c) => c[0]);
    expect(channels).toEqual(
      expect.arrayContaining([
        'mind:add',
        'mind:remove',
        'mind:list',
        'mind:setActive',
        'mind:selectDirectory',
        'mind:openWindow',
      ]),
    );
  });

  it.each([
    ['mind:add', ['']],
    ['mind:remove', ['']],
    ['mind:setActive', [42]],
    ['mind:openWindow', []],
  ] as const)('%s rejects bad args', async (channel, bad) => {
    const mgr = fakeMindManager();
    setupMindIPC(mgr, { preloadPath: '/pre' });
    const handler = getHandler(channel);
    await expect(handler({ sender: {} }, ...bad)).rejects.toBeInstanceOf(IpcValidationError);
  });

  it('mind:add accepts string and delegates', async () => {
    const mgr = fakeMindManager();
    setupMindIPC(mgr, { preloadPath: '/pre' });
    await getHandler('mind:add')({ sender: {} }, '/tmp/m1');
    expect(mgr.loadMind).toHaveBeenCalledWith('/tmp/m1');
  });

  it('mind:list accepts no args', async () => {
    const mgr = fakeMindManager();
    setupMindIPC(mgr, { preloadPath: '/pre' });
    await getHandler('mind:list')({ sender: {} });
    expect(mgr.awaitRestore).toHaveBeenCalled();
    expect(mgr.listMinds).toHaveBeenCalled();
  });
});
