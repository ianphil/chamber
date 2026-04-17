import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: {
    fromWebContents: vi.fn(),
    getAllWindows: vi.fn().mockReturnValue([]),
  },
  shell: { openExternal: vi.fn() },
  app: { isPackaged: false },
}));

import { ipcMain, BrowserWindow } from 'electron';
import { setupAuthIPC } from './auth';
import { IpcValidationError } from '../../contracts/errors';
import type { AuthService } from '../services/auth';
import type { MindManager } from '../services/mind';
import { Dispatcher } from '../rpc/dispatcher';
import { PushBus } from '../rpc/pushBus';
import { installIpcPushSink } from './pushSink';

function createFakeAuth() {
  return {
    getStoredCredential: vi.fn().mockResolvedValue(null),
    listAccounts: vi.fn().mockResolvedValue([]),
    setProgressHandler: vi.fn(),
    startLogin: vi.fn().mockResolvedValue({ success: true }),
    logout: vi.fn().mockResolvedValue(undefined),
    setActiveLogin: vi.fn(),
  } as unknown as AuthService;
}

function createFakeMindManager() {
  return {
    reloadAllMinds: vi.fn().mockResolvedValue(undefined),
  } as unknown as MindManager;
}

function install(auth: AuthService, mgr: MindManager) {
  const dispatcher = new Dispatcher();
  const pushBus = new PushBus();
  installIpcPushSink(pushBus);
  setupAuthIPC(dispatcher, pushBus, auth, mgr);
}

function getHandler(channel: string) {
  const call = vi.mocked(ipcMain.handle).mock.calls.find((c) => c[0] === channel);
  if (!call) throw new Error(`handler not registered: ${channel}`);
  return call[1] as (event: unknown, ...args: unknown[]) => Promise<unknown>;
}

function mockWindows(sends: ReturnType<typeof vi.fn>[]) {
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue(
    sends.map((send) => ({
      isDestroyed: () => false,
      webContents: { send },
    })) as never,
  );
}

describe('setupAuthIPC', () => {
  beforeEach(() => {
    vi.mocked(ipcMain.handle).mockClear();
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([] as never);
  });

  it('registers all auth handlers', () => {
    install(createFakeAuth(), createFakeMindManager());
    const channels = vi.mocked(ipcMain.handle).mock.calls.map((c) => c[0]);
    expect(channels).toContain('auth:getStatus');
    expect(channels).toContain('auth:listAccounts');
    expect(channels).toContain('auth:startLogin');
    expect(channels).toContain('auth:switchAccount');
    expect(channels).toContain('auth:logout');
  });

  it('auth:listAccounts returns authService.listAccounts()', async () => {
    const fakeAuth = createFakeAuth();
    fakeAuth.listAccounts = vi.fn().mockResolvedValue([{ login: 'alice' }]);
    install(fakeAuth, createFakeMindManager());
    await expect(getHandler('auth:listAccounts')({ sender: {} })).resolves.toEqual([
      { login: 'alice' },
    ]);
  });

  it('auth:switchAccount sets activeLogin, reloads minds, and broadcasts accountSwitched', async () => {
    const fakeAuth = createFakeAuth();
    const fakeMgr = createFakeMindManager();
    fakeAuth.listAccounts = vi.fn().mockResolvedValue([{ login: 'alice' }, { login: 'bob' }]);
    const send = vi.fn();
    mockWindows([send]);

    install(fakeAuth, fakeMgr);
    await getHandler('auth:switchAccount')({ sender: {} }, 'bob');

    expect(fakeAuth.setActiveLogin).toHaveBeenCalledWith('bob');
    expect(fakeMgr.reloadAllMinds).toHaveBeenCalled();
    expect(send).toHaveBeenNthCalledWith(1, 'auth:accountSwitchStarted', { login: 'bob' });
    expect(send).toHaveBeenNthCalledWith(2, 'auth:accountSwitched', { login: 'bob' });
  });

  it('auth:switchAccount rejects with IpcValidationError on empty login', async () => {
    install(createFakeAuth(), createFakeMindManager());
    await expect(getHandler('auth:switchAccount')({ sender: {} }, '')).rejects.toBeInstanceOf(
      IpcValidationError,
    );
  });

  it('auth:switchAccount rejects when account is missing', async () => {
    const fakeAuth = createFakeAuth();
    fakeAuth.listAccounts = vi.fn().mockResolvedValue([{ login: 'alice' }]);
    install(fakeAuth, createFakeMindManager());
    await expect(getHandler('auth:switchAccount')({ sender: {} }, 'bob')).rejects.toThrow(
      'Account bob is not available',
    );
  });

  it('auth:startLogin sets activeLogin, reloads minds, and broadcasts', async () => {
    const fakeAuth = createFakeAuth();
    const fakeMgr = createFakeMindManager();
    fakeAuth.startLogin = vi.fn().mockResolvedValue({ success: true, login: 'alice' });
    const send = vi.fn();
    mockWindows([send]);
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue({
      isDestroyed: () => false,
      webContents: { send },
    } as never);

    install(fakeAuth, fakeMgr);

    await expect(getHandler('auth:startLogin')({ sender: {} })).resolves.toEqual({
      success: true,
      login: 'alice',
    });
    expect(fakeAuth.setActiveLogin).toHaveBeenCalledWith('alice');
    expect(fakeMgr.reloadAllMinds).toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith('auth:accountSwitchStarted', { login: 'alice' });
    expect(send).toHaveBeenCalledWith('auth:accountSwitched', { login: 'alice' });
  });

  it('auth:switchAccount still broadcasts accountSwitched when reloadAllMinds rejects', async () => {
    const fakeAuth = createFakeAuth();
    const fakeMgr = createFakeMindManager();
    fakeMgr.reloadAllMinds = vi.fn().mockRejectedValue(new Error('disk failure')) as never;
    fakeAuth.listAccounts = vi.fn().mockResolvedValue([{ login: 'alice' }]);
    const send = vi.fn();
    mockWindows([send]);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(vi.fn());
    install(fakeAuth, fakeMgr);
    await getHandler('auth:switchAccount')({ sender: {} }, 'alice');

    expect(send).toHaveBeenCalledWith('auth:accountSwitched', { login: 'alice' });
    consoleSpy.mockRestore();
  });

  it('auth:logout calls authService.logout and broadcasts to all windows', async () => {
    const fakeAuth = createFakeAuth();
    const send1 = vi.fn();
    const send2 = vi.fn();
    mockWindows([send1, send2]);

    install(fakeAuth, createFakeMindManager());
    await getHandler('auth:logout')({ sender: {} });

    expect(fakeAuth.logout).toHaveBeenCalled();
    expect(send1).toHaveBeenCalledWith('auth:loggedOut');
    expect(send2).toHaveBeenCalledWith('auth:loggedOut');
  });
});
