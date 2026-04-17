import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

import { ipcMain } from 'electron';
import { setupLensIPC } from './lens';
import { IpcValidationError } from '../../contracts/errors';
import type { ViewDiscovery } from '../services/lens';
import type { MindManager } from '../services/mind';

function fakeViewDiscovery() {
  return {
    getViews: vi.fn().mockResolvedValue([]),
    getViewData: vi.fn().mockResolvedValue({}),
    refreshView: vi.fn().mockResolvedValue({}),
    sendAction: vi.fn().mockResolvedValue({}),
  } as unknown as ViewDiscovery;
}

function fakeMindManager() {
  return {
    getActiveMindId: vi.fn().mockReturnValue('m1'),
    getMind: vi.fn().mockReturnValue({ mindPath: '/tmp/m1' }),
  } as unknown as MindManager;
}

function getHandler(channel: string): (event: unknown, ...args: unknown[]) => unknown {
  const call = vi.mocked(ipcMain.handle).mock.calls.find((c) => c[0] === channel);
  if (!call) throw new Error(`handler not registered: ${channel}`);
  return call[1] as (event: unknown, ...args: unknown[]) => unknown;
}

describe('setupLensIPC — validation', () => {
  beforeEach(() => vi.mocked(ipcMain.handle).mockClear());

  it('registers all lens handlers', () => {
    setupLensIPC(fakeViewDiscovery(), fakeMindManager());
    const channels = vi.mocked(ipcMain.handle).mock.calls.map((c) => c[0]);
    expect(channels).toEqual(
      expect.arrayContaining([
        'lens:getViews',
        'lens:getViewData',
        'lens:refreshView',
        'lens:sendAction',
      ]),
    );
  });

  it.each([
    ['lens:getViewData', []],
    ['lens:refreshView', []],
    ['lens:sendAction', ['v1']],
  ] as const)('%s rejects bad args', async (channel, bad) => {
    setupLensIPC(fakeViewDiscovery(), fakeMindManager());
    await expect(getHandler(channel)({ sender: {} }, ...bad)).rejects.toBeInstanceOf(
      IpcValidationError,
    );
  });

  it('lens:getViews accepts no args', async () => {
    const vd = fakeViewDiscovery();
    setupLensIPC(vd, fakeMindManager());
    await getHandler('lens:getViews')({ sender: {} });
    expect(vd.getViews).toHaveBeenCalledWith('/tmp/m1');
  });

  it('lens:sendAction delegates on valid args', async () => {
    const vd = fakeViewDiscovery();
    setupLensIPC(vd, fakeMindManager());
    await getHandler('lens:sendAction')({ sender: {} }, 'v1', 'save');
    expect(vd.sendAction).toHaveBeenCalledWith('v1', 'save', '/tmp/m1');
  });
});
