import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { on: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn().mockReturnValue(null) },
}));

import { ipcMain } from 'electron';
import { setupWindowIPC } from './window';
import { Dispatcher } from '../rpc/dispatcher';

type OnCall = [string, (event: unknown, ...args: unknown[]) => void];

function getListener(channel: string): (event: unknown, ...args: unknown[]) => void {
  const calls = vi.mocked(ipcMain.on).mock.calls as OnCall[];
  const match = calls.find((c) => c[0] === channel);
  if (!match) throw new Error(`No listener registered for ${channel}`);
  return match[1];
}

function fakeEvent() {
  return { sender: {} } as unknown as Electron.IpcMainEvent;
}

describe('Window IPC', () => {
  let win: {
    minimize: ReturnType<typeof vi.fn>;
    maximize: ReturnType<typeof vi.fn>;
    unmaximize: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    isMaximized: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    win = {
      minimize: vi.fn(),
      maximize: vi.fn(),
      unmaximize: vi.fn(),
      close: vi.fn(),
      isMaximized: vi.fn(() => false),
    };
    setupWindowIPC(new Dispatcher(), () => win as unknown as Electron.BrowserWindow);
  });

  it('minimize invokes minimize()', async () => {
    await getListener('window:minimize')(fakeEvent());
    expect(win.minimize).toHaveBeenCalled();
  });

  it('maximize toggles: maximizes when not maximized', async () => {
    await getListener('window:maximize')(fakeEvent());
    expect(win.maximize).toHaveBeenCalled();
    expect(win.unmaximize).not.toHaveBeenCalled();
  });

  it('maximize toggles: unmaximizes when already maximized', async () => {
    win.isMaximized.mockReturnValue(true);
    await getListener('window:maximize')(fakeEvent());
    expect(win.unmaximize).toHaveBeenCalled();
    expect(win.maximize).not.toHaveBeenCalled();
  });

  it('close invokes close()', async () => {
    await getListener('window:close')(fakeEvent());
    expect(win.close).toHaveBeenCalled();
  });

  it('invalid extra args are logged and dropped (no action taken)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await getListener('window:minimize')(fakeEvent(), 'extra');
    // Let the error path flush.
    await new Promise((r) => setTimeout(r, 0));
    expect(win.minimize).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('tolerates missing main window', () => {
    vi.clearAllMocks();
    vi.mocked(ipcMain.on).mockClear();
    setupWindowIPC(new Dispatcher(), () => null);
    expect(() => getListener('window:close')(fakeEvent())).not.toThrow();
  });
});
