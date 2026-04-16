import { describe, it, expect, vi } from 'vitest';

// Mock electron's app module before importing AuthService helpers
vi.mock('electron', () => ({
  app: { getVersion: vi.fn().mockReturnValue('0.14.0'), isPackaged: false },
}));

// Mock keytar to avoid native module loading
vi.mock('keytar', () => ({
  findCredentials: vi.fn().mockResolvedValue([]),
  setPassword: vi.fn().mockResolvedValue(undefined),
  deletePassword: vi.fn().mockResolvedValue(true),
}));

import { getCredentialAccount, getLoginFromAccount, AuthService } from './AuthService';

type KeytarModule = typeof import('keytar');

function createMockKeytar(overrides?: Partial<{ [K in keyof KeytarModule]: ReturnType<typeof vi.fn> }>): KeytarModule {
  return {
    getPassword: vi.fn().mockResolvedValue(null),
    setPassword: vi.fn().mockResolvedValue(undefined),
    deletePassword: vi.fn().mockResolvedValue(true),
    findPassword: vi.fn().mockResolvedValue(null),
    findCredentials: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as KeytarModule;
}

describe('getCredentialAccount', () => {
  it('prefixes login with GitHub account prefix', () => {
    expect(getCredentialAccount('alice')).toBe('https://github.com:alice');
  });

  it('returns prefix only for empty string', () => {
    expect(getCredentialAccount('')).toBe('https://github.com:');
  });
});

describe('getLoginFromAccount', () => {
  it('extracts login from valid account string', () => {
    expect(getLoginFromAccount('https://github.com:alice')).toBe('alice');
  });

  it('returns null for wrong prefix', () => {
    expect(getLoginFromAccount('https://gitlab.com:alice')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(getLoginFromAccount('')).toBeNull();
  });

  it('returns null for prefix only (no login)', () => {
    expect(getLoginFromAccount('https://github.com:')).toBeNull();
  });
});

describe('AuthService.logout', () => {
  it('deletes the stored credential via keytar', async () => {
    const mockKeytar = createMockKeytar({
      findCredentials: vi.fn().mockResolvedValue([
        { account: 'https://github.com:alice', password: 'gho_token123' },
      ]),
    });
    const service = new AuthService(mockKeytar);
    await service.logout();
    expect(mockKeytar.deletePassword).toHaveBeenCalledWith('copilot-cli', 'https://github.com:alice');
  });

  it('does not throw when no credential is stored', async () => {
    const mockKeytar = createMockKeytar();
    const service = new AuthService(mockKeytar);
    await expect(service.logout()).resolves.toBeUndefined();
    expect(mockKeytar.deletePassword).not.toHaveBeenCalled();
  });
});

describe('AuthService multi-account', () => {
  it('listAccounts returns all stored accounts sorted alphabetically', async () => {
    const mockKeytar = createMockKeytar({
      findCredentials: vi.fn().mockResolvedValue([
        { account: 'https://github.com:zebra', password: 'token2' },
        { account: 'https://github.com:alice', password: 'token1' },
      ]),
    });

    const service = new AuthService(mockKeytar);
    await expect(service.listAccounts()).resolves.toEqual([
      { login: 'alice' },
      { login: 'zebra' },
    ]);
  });

  it('listAccounts returns empty array when no credentials exist', async () => {
    const service = new AuthService(createMockKeytar());
    await expect(service.listAccounts()).resolves.toEqual([]);
  });

  it('listAccounts filters out malformed accounts', async () => {
    const mockKeytar = createMockKeytar({
      findCredentials: vi.fn().mockResolvedValue([
        { account: 'https://gitlab.com:alice', password: 'token1' },
        { account: 'https://github.com:bob', password: 'token2' },
      ]),
    });

    const service = new AuthService(mockKeytar);
    await expect(service.listAccounts()).resolves.toEqual([{ login: 'bob' }]);
  });

  it('getStoredCredential returns the configured active account', async () => {
    const mockKeytar = createMockKeytar({
      findCredentials: vi.fn().mockResolvedValue([
        { account: 'https://github.com:alice', password: 'token1' },
        { account: 'https://github.com:bob', password: 'token2' },
      ]),
    });

    const service = new AuthService(mockKeytar, () => 'bob');
    await expect(service.getStoredCredential()).resolves.toEqual({ login: 'bob' });
  });

  it('getStoredCredential falls back to the first stored account when activeLogin is null', async () => {
    const mockKeytar = createMockKeytar({
      findCredentials: vi.fn().mockResolvedValue([
        { account: 'https://github.com:bob', password: 'token2' },
        { account: 'https://github.com:alice', password: 'token1' },
      ]),
    });

    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(vi.fn());
    const service = new AuthService(mockKeytar, () => null);

    await expect(service.getStoredCredential()).resolves.toEqual({ login: 'alice' });
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('getStoredCredential returns null when activeLogin is set but missing', async () => {
    const mockKeytar = createMockKeytar({
      findCredentials: vi.fn().mockResolvedValue([
        { account: 'https://github.com:alice', password: 'token1' },
      ]),
    });

    const service = new AuthService(mockKeytar, () => 'bob');
    await expect(service.getStoredCredential()).resolves.toBeNull();
  });

  it('logout deletes only the active credential and clears activeLogin', async () => {
    const mockKeytar = createMockKeytar({
      findCredentials: vi.fn().mockResolvedValue([
        { account: 'https://github.com:alice', password: 'token1' },
        { account: 'https://github.com:bob', password: 'token2' },
      ]),
    });
    const setActiveLogin = vi.fn();
    const service = new AuthService(mockKeytar, () => 'bob', setActiveLogin);

    await service.logout();

    expect(mockKeytar.deletePassword).toHaveBeenCalledWith('copilot-cli', 'https://github.com:bob');
    expect(setActiveLogin).toHaveBeenCalledWith(null);
  });
});
