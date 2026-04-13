import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn() },
  shell: { openExternal: vi.fn() },
  app: { isPackaged: false },
}));

import { ipcMain } from 'electron';
import { setupAuthIPC } from './auth';
import type { AuthService } from '../services/auth';

describe('setupAuthIPC', () => {
  it('accepts injected AuthService and registers handlers', () => {
    const fakeAuth = {
      getStoredCredential: vi.fn().mockResolvedValue(null),
      setProgressHandler: vi.fn(),
      startLogin: vi.fn().mockResolvedValue({ success: true }),
    } as unknown as AuthService;
    setupAuthIPC(fakeAuth);
    const channels = vi.mocked(ipcMain.handle).mock.calls.map(c => c[0]);
    expect(channels).toContain('auth:getStatus');
    expect(channels).toContain('auth:startLogin');
  });
});
