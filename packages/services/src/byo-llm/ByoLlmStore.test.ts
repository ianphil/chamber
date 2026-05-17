import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  BYO_LLM_CREDENTIAL_ACCOUNT,
  BYO_LLM_CREDENTIAL_SERVICE,
  ByoLlmStore,
  hasUrlCredentials,
  redactConfigForLog,
  redactUrlCredentials,
} from './ByoLlmStore';
import type { ByoLlmConfig } from '@chamber/shared/types';
import type { CredentialStore } from '../ports';

function createCredentialStore(): CredentialStore {
  const entries = new Map<string, string>();
  const key = (service: string, account: string) => `${service}\0${account}`;
  return {
    findCredentials: vi.fn(async (service: string) => Array.from(entries.entries())
      .filter(([entryKey]) => entryKey.startsWith(`${service}\0`))
      .map(([entryKey, password]) => ({ account: entryKey.slice(service.length + 1), password }))),
    setPassword: vi.fn(async (service: string, account: string, password: string) => {
      entries.set(key(service, account), password);
    }),
    deletePassword: vi.fn(async (service: string, account: string) => entries.delete(key(service, account))),
  };
}

async function readStoredSecret(credentials: CredentialStore): Promise<Record<string, unknown> | null> {
  const entry = (await credentials.findCredentials(BYO_LLM_CREDENTIAL_SERVICE))
    .find((credential) => credential.account === BYO_LLM_CREDENTIAL_ACCOUNT);
  return entry ? JSON.parse(entry.password) as Record<string, unknown> : null;
}

describe('ByoLlmStore', () => {
  let tempDir: string;
  let store: ByoLlmStore;
  let credentials: CredentialStore;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'byo-llm-store-'));
    credentials = createCredentialStore();
    store = new ByoLlmStore({ storeDir: tempDir, credentials });
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  });

  it('BVT-S01: load returns null when file does not exist', async () => {
    expect(await store.load()).toBeNull();
  });

  it('BVT-S02: load returns null on corrupt JSON', async () => {
    fs.writeFileSync(store.getFilePath(), '{ not valid json', 'utf-8');
    expect(await store.load()).toBeNull();
  });

  it('BVT-S03: load returns null when required fields missing', async () => {
    fs.writeFileSync(store.getFilePath(), JSON.stringify({ enabled: true }), 'utf-8');
    expect(await store.load()).toBeNull();
  });

  it('BVT-S04: round-trip save then load returns the same config without writing secrets to JSON', async () => {
    const config: ByoLlmConfig = {
      enabled: true,
      baseUrl: 'https://example.com/v1',
      apiKey: 'lm-studio',
      bearerToken: 'token',
      model: 'gemma-4-e4b',
      providerType: 'openai',
      customHeaders: { 'X-Tunnel-Skip': 'true' },
    };
    await store.save(config);
    const loaded = await store.load();
    expect(loaded).toEqual(config);
    const file = fs.readFileSync(store.getFilePath(), 'utf-8');
    expect(file).not.toContain('lm-studio');
    expect(file).not.toContain('token');
    expect(file).not.toContain('X-Tunnel-Skip');
    await expect(readStoredSecret(credentials)).resolves.toEqual({
      apiKey: 'lm-studio',
      bearerToken: 'token',
      customHeaders: { 'X-Tunnel-Skip': 'true' },
    });
  });

  it('BVT-S05: save uses atomic write (no .tmp file remains)', async () => {
    await store.save({ enabled: true, baseUrl: 'https://example.com/v1' });
    const files = fs.readdirSync(tempDir);
    expect(files.some((f) => f.includes('.tmp'))).toBe(false);
    expect(files).toContain('byo-llm.json');
  });

  it('BVT-S06: clear removes the file (idempotent on missing)', async () => {
    await store.save({ enabled: true, baseUrl: 'https://example.com/v1' });
    expect(fs.existsSync(store.getFilePath())).toBe(true);
    await store.clear();
    expect(fs.existsSync(store.getFilePath())).toBe(false);
    expect(await readStoredSecret(credentials)).toBeNull();
    // Idempotent — second clear should not throw
    await expect(store.clear()).resolves.toBeUndefined();
  });

  it('BVT-S07: load strips unknown fields and bad-type values', async () => {
    fs.writeFileSync(
      store.getFilePath(),
      JSON.stringify({
        enabled: true,
        baseUrl: 'https://example.com/v1',
        providerType: 'unknown-provider',  // dropped
        wireApi: 'fake',                    // dropped
        maxPromptTokens: 'not-a-number',    // dropped
        unknownExtraField: 'ignored',       // dropped
        customHeaders: ['not', 'an', 'object'], // dropped
        model: 'kept',
      }),
      'utf-8',
    );
    const loaded = await store.load();
    expect(loaded).toEqual({
      enabled: true,
      baseUrl: 'https://example.com/v1',
      model: 'kept',
    });
  });

  it('BVT-S08: redactConfigForLog never includes apiKey or bearerToken values', () => {
    const out = redactConfigForLog({
      enabled: true,
      baseUrl: 'https://example.com/v1',
      apiKey: 'super-secret-key-do-not-leak',
      bearerToken: 'jwt-also-do-not-leak',
      customHeaders: { 'X-Auth': 'header-value' },
    });
    expect(out).not.toContain('super-secret-key-do-not-leak');
    expect(out).not.toContain('jwt-also-do-not-leak');
    expect(out).not.toContain('header-value');
    expect(out).toContain('apiKey=<redacted>');
    expect(out).toContain('bearerToken=<redacted>');
    expect(out).toContain('customHeaders=<1 keys, redacted>');
  });

  it('BVT-S08a: redactConfigForLog strips userinfo from baseUrl', () => {
    const out = redactConfigForLog({
      enabled: true,
      baseUrl: 'https://alice:hunter2@example.com/v1',
    });
    expect(out).not.toContain('alice');
    expect(out).not.toContain('hunter2');
    expect(out).toContain('baseUrl=https://example.com/v1');
  });

  it('BVT-S08b: save rejects baseUrl containing URL credentials', async () => {
    await expect(store.save({
      enabled: true,
      baseUrl: 'https://alice:hunter2@example.com/v1',
    })).rejects.toThrow(/must not contain URL credentials/i);
    expect(fs.existsSync(store.getFilePath())).toBe(false);
  });

  it('BVT-S08c: hasUrlCredentials detects userinfo, redactUrlCredentials strips it', () => {
    expect(hasUrlCredentials('https://alice:hunter2@example.com/v1')).toBe(true);
    expect(hasUrlCredentials('https://alice@example.com/v1')).toBe(true);
    expect(hasUrlCredentials('https://example.com/v1')).toBe(false);
    expect(hasUrlCredentials('not a url')).toBe(false);
    expect(redactUrlCredentials('https://alice:hunter2@example.com/v1')).toBe('https://example.com/v1');
    expect(redactUrlCredentials('https://example.com/v1')).toBe('https://example.com/v1');
    expect(redactUrlCredentials('not a url')).toBe('not a url');
  });

  it('BVT-S08d: save rejects customHeaders containing CR or LF', async () => {
    await expect(store.save({
      enabled: true,
      baseUrl: 'https://example.com/v1',
      customHeaders: { 'X-Inject': 'value\r\nX-Smuggled: bad' },
    })).rejects.toThrow(/must not contain CR or LF/i);

    await expect(store.save({
      enabled: true,
      baseUrl: 'https://example.com/v1',
      customHeaders: { 'X-Bad\nName': 'value' },
    })).rejects.toThrow(/must not contain CR or LF/i);

    expect(fs.existsSync(store.getFilePath())).toBe(false);
  });

  it('BVT-S09: migrates legacy plaintext secrets into the OS credential store and rewrites JSON', async () => {
    fs.writeFileSync(
      store.getFilePath(),
      JSON.stringify({
        enabled: true,
        baseUrl: 'https://example.com/v1',
        providerType: 'openai',
        apiKey: 'legacy-key',
        bearerToken: 'legacy-token',
        customHeaders: { 'X-Secret': 'legacy-header' },
        model: 'gemma',
      }),
      'utf-8',
    );

    const loaded = await store.load();

    expect(loaded).toMatchObject({
      enabled: true,
      baseUrl: 'https://example.com/v1',
      apiKey: 'legacy-key',
      bearerToken: 'legacy-token',
      customHeaders: { 'X-Secret': 'legacy-header' },
      model: 'gemma',
    });
    const file = fs.readFileSync(store.getFilePath(), 'utf-8');
    expect(file).not.toContain('legacy-key');
    expect(file).not.toContain('legacy-token');
    expect(file).not.toContain('legacy-header');
    await expect(readStoredSecret(credentials)).resolves.toEqual({
      apiKey: 'legacy-key',
      bearerToken: 'legacy-token',
      customHeaders: { 'X-Secret': 'legacy-header' },
    });
  });

  it('BVT-S10: saving a config without secrets clears any existing BYO credential', async () => {
    await store.save({
      enabled: true,
      baseUrl: 'https://example.com/v1',
      apiKey: 'secret',
      model: 'gemma',
    });
    expect(await readStoredSecret(credentials)).not.toBeNull();

    await store.save({
      enabled: true,
      baseUrl: 'https://example.com/v1',
      model: 'gemma',
    });

    expect(await readStoredSecret(credentials)).toBeNull();
  });

  it('BVT-S11: refuses to return legacy plaintext secrets when the credential store is unavailable', async () => {
    const failingCredentials: CredentialStore = {
      findCredentials: vi.fn(async () => {
        throw new Error('keychain unavailable');
      }),
      setPassword: vi.fn(async () => undefined),
      deletePassword: vi.fn(async () => true),
    };
    store = new ByoLlmStore({ storeDir: tempDir, credentials: failingCredentials });
    fs.writeFileSync(
      store.getFilePath(),
      JSON.stringify({
        enabled: true,
        baseUrl: 'https://example.com/v1',
        apiKey: 'legacy-key',
        customHeaders: { 'X-Secret': 'legacy-header' },
        model: 'gemma',
      }),
      'utf-8',
    );

    await expect(store.load()).resolves.toBeNull();
    expect(failingCredentials.setPassword).not.toHaveBeenCalled();
  });
});
