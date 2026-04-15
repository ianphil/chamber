import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn(), getAllWindows: vi.fn().mockReturnValue([]) },
  shell: { openExternal: vi.fn() },
  app: { isPackaged: false },
}));

import { ipcMain, BrowserWindow } from 'electron';
import { setupAuthIPC } from './auth';
import type { AuthService } from '../services/auth';

function createFakeAuth() {
  return {
    getStoredCredential: vi.fn().mockResolvedValue(null),
    setProgressHandler: vi.fn(),
    startLogin: vi.fn().mockResolvedValue({ success: true }),
    logout: vi.fn().mockResolvedValue(undefined),
  } as unknown as AuthService;
}

describe('setupAuthIPC', () => {
  beforeEach(() => {
    vi.mocked(ipcMain.handle).mockClear();
  });

  it('registers auth:getStatus, auth:startLogin, and auth:logout handlers', () => {
    setupAuthIPC(createFakeAuth());
    const channels = vi.mocked(ipcMain.handle).mock.calls.map(c => c[0]);
    expect(channels).toContain('auth:getStatus');
    expect(channels).toContain('auth:startLogin');
    expect(channels).toContain('auth:logout');
  });

  it('auth:logout handler calls authService.logout and broadcasts to all windows', async () => {
    const fakeAuth = createFakeAuth();
    const mockSend = vi.fn();
    const mockWindows = [
      { webContents: { send: mockSend } },
      { webContents: { send: mockSend } },
    ];
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue(mockWindows as never);

    setupAuthIPC(fakeAuth);

    // Find and invoke the auth:logout handler
    const logoutCall = vi.mocked(ipcMain.handle).mock.calls.find(c => c[0] === 'auth:logout');
    expect(logoutCall).toBeDefined();
    await logoutCall![1]({} as never, ...([] as never));

    expect(fakeAuth.logout).toHaveBeenCalled();
    expect(mockSend).toHaveBeenCalledWith('auth:loggedOut');
    expect(mockSend).toHaveBeenCalledTimes(2);
  });
});
