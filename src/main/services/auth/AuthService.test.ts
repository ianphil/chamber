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

import { getCredentialAccount, getLoginFromAccount, resolveStoredCredential, AuthService } from './AuthService';

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

describe('resolveStoredCredential', () => {
  it('returns credential for valid entry', () => {
    const result = resolveStoredCredential([
      { account: 'https://github.com:alice', password: 'gho_token123' },
    ]);
    expect(result).toEqual({ login: 'alice', account: 'https://github.com:alice', password: 'gho_token123' });
  });

  it('returns first credential when multiple exist', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(vi.fn());
    const result = resolveStoredCredential([
      { account: 'https://github.com:alice', password: 'token1' },
      { account: 'https://github.com:bob', password: 'token2' },
    ]);
    expect(result?.login).toBe('alice');
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('returns null for no valid credentials', () => {
    expect(resolveStoredCredential([
      { account: 'https://gitlab.com:alice', password: 'token' },
    ])).toBeNull();
  });

  it('returns null for empty array', () => {
    expect(resolveStoredCredential([])).toBeNull();
  });

  it('skips entries with empty password', () => {
    expect(resolveStoredCredential([
      { account: 'https://github.com:alice', password: '' },
    ])).toBeNull();
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
