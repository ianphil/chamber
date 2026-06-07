import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  AZURE_SPEECH_CREDENTIAL_ACCOUNT,
  AZURE_SPEECH_CREDENTIAL_SERVICE,
  AzureSpeechStore,
  type FetchLike,
} from './AzureSpeechStore';
import type { AzureSpeechConfig } from '@chamber/shared/types';
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

async function readStoredKey(credentials: CredentialStore): Promise<string | null> {
  const entry = (await credentials.findCredentials(AZURE_SPEECH_CREDENTIAL_SERVICE))
    .find((credential) => credential.account === AZURE_SPEECH_CREDENTIAL_ACCOUNT);
  return entry ? entry.password : null;
}

describe('AzureSpeechStore', () => {
  let tempDir: string;
  let credentials: CredentialStore;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'azure-speech-store-'));
    credentials = createCredentialStore();
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  });

  function makeStore(fetchImpl?: FetchLike, now?: () => number): AzureSpeechStore {
    return new AzureSpeechStore({ storeDir: tempDir, credentials, fetchImpl, now });
  }

  it('returns null when the config file does not exist', async () => {
    expect(await makeStore().load()).toBeNull();
  });

  it('returns null on corrupt JSON', async () => {
    const store = makeStore();
    fs.writeFileSync(store.getFilePath(), '{ not valid json', 'utf-8');
    expect(await store.load()).toBeNull();
  });

  it('returns null when required fields are missing', async () => {
    const store = makeStore();
    fs.writeFileSync(store.getFilePath(), JSON.stringify({ enabled: true }), 'utf-8');
    expect(await store.load()).toBeNull();
  });

  it('round-trips config and keeps the key out of the JSON file', async () => {
    const store = makeStore();
    const config: AzureSpeechConfig = {
      enabled: true,
      region: 'eastus',
      sttLanguage: 'en-US',
      ttsVoice: 'en-US-AvaNeural',
      apiKey: 'super-secret-key',
    };
    await store.save(config);
    const loaded = await store.load();
    expect(loaded).toEqual(config);

    const file = fs.readFileSync(store.getFilePath(), 'utf-8');
    expect(file).not.toContain('super-secret-key');
    await expect(readStoredKey(credentials)).resolves.toBe('super-secret-key');
  });

  it('clear removes both the file and the stored key', async () => {
    const store = makeStore();
    await store.save({ enabled: true, region: 'eastus', apiKey: 'k' });
    await store.clear();
    expect(fs.existsSync(store.getFilePath())).toBe(false);
    await expect(readStoredKey(credentials)).resolves.toBeNull();
    expect(await store.load()).toBeNull();
  });

  it('mintToken exchanges the stored key for a short-lived token', async () => {
    const fetchImpl = vi.fn<FetchLike>(async (url, init) => {
      expect(url).toBe('https://eastus.api.cognitive.microsoft.com/sts/v1.0/issueToken');
      expect(init?.method).toBe('POST');
      expect(init?.headers?.['Ocp-Apim-Subscription-Key']).toBe('the-key');
      return { ok: true, status: 200, text: async () => 'issued-token' };
    });
    const store = makeStore(fetchImpl, () => 1_000);
    await store.save({ enabled: true, region: 'eastus', apiKey: 'the-key' });

    const token = await store.mintToken();
    expect(token).toEqual({ token: 'issued-token', region: 'eastus', expiresAt: 1_000 + 9 * 60 * 1000 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('mintToken throws when not configured', async () => {
    await expect(makeStore().mintToken()).rejects.toThrow('not configured');
  });

  it('rejects a region that is not a simple token (SSRF guard)', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => ({ ok: true, status: 200, text: async () => 'x' }));
    const store = makeStore(fetchImpl);
    await store.save({ enabled: true, region: 'eastus', apiKey: 'k' });
    // Tamper the on-disk region with a malicious host.
    fs.writeFileSync(
      store.getFilePath(),
      JSON.stringify({ enabled: true, region: 'evil.example.com/x?' }),
      'utf-8',
    );
    await expect(store.mintToken()).rejects.toThrow('Invalid Azure region');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('testConnection reports ok on a successful token mint', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => ({ ok: true, status: 200, text: async () => 'tok' }));
    const store = makeStore(fetchImpl);
    await expect(store.testConnection({ region: 'westus2', apiKey: 'k' })).resolves.toEqual({ ok: true });
  });

  it('testConnection reports failure on an HTTP error', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => ({ ok: false, status: 401, text: async () => '' }));
    const store = makeStore(fetchImpl);
    const result = await store.testConnection({ region: 'westus2', apiKey: 'bad' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('401');
  });

  it('testConnection falls back to stored credentials when not supplied', async () => {
    const fetchImpl = vi.fn<FetchLike>(async (_url, init) => {
      expect(init?.headers?.['Ocp-Apim-Subscription-Key']).toBe('stored-key');
      return { ok: true, status: 200, text: async () => 'tok' };
    });
    const store = makeStore(fetchImpl);
    await store.save({ enabled: true, region: 'eastus', apiKey: 'stored-key' });
    await expect(store.testConnection()).resolves.toEqual({ ok: true });
  });
});
