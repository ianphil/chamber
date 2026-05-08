import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';

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

// Per-test programmable https mock. Tests push fixtures onto httpsResponses
// before invoking startLogin; each https.request consumes one fixture FIFO.
// Default behavior (no fixtures queued) is to error immediately so tests
// that don't care about the network path still complete fast.
type HttpsFixture =
  | { kind: 'json'; status?: number; body: Record<string, unknown> }
  | { kind: 'error'; error: Error }
  | { kind: 'never' };
const httpsResponses: HttpsFixture[] = [];
const httpsCalls: Array<{ host: string; path: string }> = [];

vi.mock('https', () => {
  const request = vi.fn((options: { hostname: string; path: string }, callback?: (res: Readable) => void) => {
    httpsCalls.push({ host: options.hostname, path: options.path });
    const req = new EventEmitter() as EventEmitter & {
      write: () => void;
      end: () => void;
    };
    req.write = () => undefined;
    req.end = () => undefined;
    const fixture = httpsResponses.shift() ?? { kind: 'error', error: new Error('Test fixture: no https fixture queued') };
    if (fixture.kind === 'never') return req;
    queueMicrotask(() => {
      if (fixture.kind === 'error') {
        req.emit('error', fixture.error);
        return;
      }
      const res = new EventEmitter() as EventEmitter & { statusCode?: number };
      res.statusCode = fixture.status ?? 200;
      callback?.(res as unknown as Readable);
      res.emit('data', JSON.stringify(fixture.body));
      res.emit('end');
    });
    return req;
  });
  return { default: { request }, request };
});

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

describe('AuthService.startLogin per-attempt isolation (#139)', () => {
  beforeEach(() => {
    httpsResponses.length = 0;
    httpsCalls.length = 0;
  });

  it('routes progress to the per-attempt onProgress callback only', async () => {
    const service = new AuthService(createMockKeytar());
    const progressA: Array<{ step: string }> = [];
    const progressB: Array<{ step: string }> = [];

    // Each startLogin makes one https call (device-code POST) which we error
    // out so the catch path runs onProgress with step:'error'. Two queued
    // errors, two attempts in parallel.
    httpsResponses.push({ kind: 'error', error: new Error('A') });
    httpsResponses.push({ kind: 'error', error: new Error('B') });

    const [resultA, resultB] = await Promise.all([
      service.startLogin({ onProgress: (p) => progressA.push({ step: p.step }) }),
      service.startLogin({ onProgress: (p) => progressB.push({ step: p.step }) }),
    ]);

    expect(resultA.success).toBe(false);
    expect(resultB.success).toBe(false);
    // Each callback received exactly its own attempt's error event,
    // proving onProgress state is no longer shared across the instance.
    expect(progressA).toEqual([{ step: 'error' }]);
    expect(progressB).toEqual([{ step: 'error' }]);
  });

  it('treats an already-aborted signal at entry as a clean no-op (no network)', async () => {
    const service = new AuthService(createMockKeytar());
    const controller = new AbortController();
    controller.abort();

    const result = await service.startLogin({ signal: controller.signal });

    expect(result.success).toBe(false);
    // Entry-level abort short-circuits before any https.request runs. If a
    // future change moves the abort check below the device-code POST, this
    // assertion fails — pinning the contract.
    expect(httpsCalls).toEqual([]);
  });

  it('honors an AbortSignal aborted mid-poll: stops the loop and skips token POSTs', async () => {
    // This is the regression test that pins the contract Uncle Bob flagged
    // as untested. Without the `isAborted()` checks inside startLogin's
    // polling loop, the test fails because the loop proceeds to a second
    // https.request (the access-token POST) which is queued as 'never'
    // (a request that hangs forever) — startLogin would never resolve.
    vi.useFakeTimers();
    try {
      const service = new AuthService(createMockKeytar());
      const controller = new AbortController();

      httpsResponses.push({
        kind: 'json',
        body: {
          user_code: 'TEST-CODE',
          verification_uri: 'https://example.test/device',
          device_code: 'devcode-1',
          interval: 1,
          expires_in: 900,
        },
      });
      // If the loop ever reaches the access-token POST after the abort,
      // it will hang on this fixture and the test times out.
      httpsResponses.push({ kind: 'never' });

      const promise = service.startLogin({ signal: controller.signal });

      // Drain the device-code microtasks so the polling loop is parked
      // inside its setTimeout-based sleep with the ACCESS_TOKEN fixture
      // still queued.
      await vi.advanceTimersByTimeAsync(0);
      expect(httpsCalls.map((c) => c.path)).toEqual(['/login/device/code']);

      controller.abort();
      // Walk the timers past the 1s polling interval. With both abort
      // checks intact, the loop body wakes, sees isAborted(), and returns
      // before issuing the access-token POST.
      await vi.advanceTimersByTimeAsync(2_000);

      const result = await promise;
      expect(result).toEqual({ success: false });
      expect(httpsCalls.map((c) => c.path)).toEqual(['/login/device/code']);
    } finally {
      vi.useRealTimers();
    }
  });
});
