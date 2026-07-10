import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { IPC } from '@chamber/shared';
import { setupSkillsIPC } from './skills';

const EVT = {} as IpcMainInvokeEvent;
type InvokeHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

describe('Skills IPC', () => {
  const getMindPath = vi.fn<(mindId: string) => string | undefined>();
  const list = vi.fn<(mindPath: string) => Promise<Array<{ id: string; name: string }>>>();

  beforeEach(() => {
    vi.clearAllMocks();
    getMindPath.mockReturnValue(undefined);
    list.mockResolvedValue([]);
    setupSkillsIPC({ getMindPath }, { list });
  });

  for (const [label, value] of [
    ['null', null],
    ['undefined', undefined],
    ['number', 42],
    ['object', { mindId: 'lucy' }],
  ] as const) {
    it(`rejects ${label} mindId without resolving a mind`, async () => {
      await expect(getHandler(IPC.SKILLS.LIST_FOR_MIND)(EVT, value)).rejects.toThrow(TypeError);
      expect(getMindPath).not.toHaveBeenCalled();
      expect(list).not.toHaveBeenCalled();
    });
  }

  it('rejects an empty mindId with a channel-labeled TypeError', async () => {
    const handler = getHandler(IPC.SKILLS.LIST_FOR_MIND);
    await expect(handler(EVT, '')).rejects.toThrow(TypeError);
    await expect(handler(EVT, '')).rejects.toThrow(/skills:listForMind/);
    expect(getMindPath).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });

  it('returns [] for a stale unknown mindId', async () => {
    await expect(getHandler(IPC.SKILLS.LIST_FOR_MIND)(EVT, 'stale-mind')).resolves.toEqual([]);
    expect(getMindPath).toHaveBeenCalledWith('stale-mind');
    expect(list).not.toHaveBeenCalled();
  });

  it('lists skills only through the trusted resolved mind path', async () => {
    getMindPath.mockReturnValue('C:\\minds\\lucy');
    list.mockResolvedValue([{ id: 'lens', name: 'Lens' }]);

    await expect(getHandler(IPC.SKILLS.LIST_FOR_MIND)(EVT, 'lucy')).resolves.toEqual([
      { id: 'lens', name: 'Lens' },
    ]);
    expect(getMindPath).toHaveBeenCalledWith('lucy');
    expect(list).toHaveBeenCalledWith('C:\\minds\\lucy');
  });
});

function getHandler(channel: string): InvokeHandler {
  const call = vi.mocked(ipcMain.handle).mock.calls.find((item) => item[0] === channel);
  if (!call) throw new Error(`no handler registered for ${channel}`);
  return call[1] as InvokeHandler;
}
