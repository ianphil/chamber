// AzureSpeechStore — atomic file-backed persistence for the user's Azure
// Speech (voice) configuration.
//
// File: <storeDir>/azure-speech.json (defaults to ~/.chamber/azure-speech.json)
//
// Atomic write strategy: write to a sibling .tmp file, fsync, rename over the
// real file. Mirrors ByoLlmStore.
//
// The subscription key is stored through the injected OS credential store. The
// JSON file stores only non-secret connection metadata (region, language,
// voice). The renderer never receives the key — it authenticates with
// short-lived tokens minted here via mintToken().

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type {
  AzureSpeechConfig,
  AzureSpeechToken,
  AzureSpeechTestResult,
} from '@chamber/shared/types';
import { getErrorMessage } from '@chamber/shared/getErrorMessage';
import { Logger } from '../logger';
import type { CredentialStore } from '../ports';

const log = Logger.create('AzureSpeechStore');
const FILE_NAME = 'azure-speech.json';
export const AZURE_SPEECH_CREDENTIAL_SERVICE = 'chamber-azure-speech';
export const AZURE_SPEECH_CREDENTIAL_ACCOUNT = 'default';

/** Authorization tokens issued by Azure Speech are valid for ~10 minutes. We
 * treat them as valid for a slightly shorter window so callers refresh early. */
const TOKEN_TTL_MS = 9 * 60 * 1000;

/** Region tokens are lowercase alphanumeric with hyphens (e.g. 'eastus',
 * 'westus2'). Validating here prevents a crafted region from rewriting the
 * issueToken URL host (SSRF defense-in-depth). */
const REGION_RE = /^[a-z0-9-]+$/;

export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface AzureSpeechStoreOptions {
  storeDir?: string;
  credentials?: CredentialStore;
  /** Injected for tests; defaults to the global fetch. */
  fetchImpl?: FetchLike;
  /** Injected for tests; defaults to Date.now. */
  now?: () => number;
}

export class AzureSpeechStore {
  private readonly storeDir: string;
  private readonly filePath: string;
  private readonly credentials?: CredentialStore;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;

  constructor(options: AzureSpeechStoreOptions = {}) {
    this.storeDir = options.storeDir ?? path.join(os.homedir(), '.chamber');
    this.filePath = path.join(this.storeDir, FILE_NAME);
    this.credentials = options.credentials;
    this.fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    this.now = options.now ?? (() => Date.now());
  }

  getFilePath(): string {
    return this.filePath;
  }

  async load(): Promise<AzureSpeechConfig | null> {
    let config: AzureSpeechConfig | null = null;
    try {
      const raw = await fs.promises.readFile(this.filePath, 'utf-8');
      config = this.coerce(JSON.parse(raw) as unknown);
      if (!config) {
        log.warn(`Stored Azure Speech config at ${this.filePath} is invalid; ignoring.`);
        return null;
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') return null;
      log.warn(`Failed to read Azure Speech config from ${this.filePath}: ${getErrorMessage(err)}`);
      return null;
    }
    const apiKey = await this.loadKey();
    return apiKey ? { ...config, apiKey } : config;
  }

  async save(config: AzureSpeechConfig): Promise<void> {
    const sanitized = this.coerce(config);
    if (!sanitized) {
      throw new Error('Refusing to save invalid Azure Speech config');
    }
    if (config.apiKey && config.apiKey.length > 0) {
      await this.saveKey(config.apiKey);
    }
    await this.writeConfig(sanitized);
    log.info(`Saved Azure Speech config (region=${sanitized.region}, enabled=${sanitized.enabled})`);
  }

  async clear(): Promise<void> {
    try {
      await fs.promises.unlink(this.filePath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== 'ENOENT') throw err;
    }
    await this.clearKey();
    log.info('Cleared Azure Speech config');
  }

  /**
   * Exchanges the stored subscription key for a short-lived Azure Speech
   * authorization token. The renderer's Speech SDK authenticates with this
   * token; the key never leaves the main process.
   */
  async mintToken(): Promise<AzureSpeechToken> {
    const config = await this.load();
    if (!config) throw new Error('Azure Speech is not configured');
    if (!config.apiKey) throw new Error('Azure Speech subscription key is missing');
    return this.issueToken(config.region, config.apiKey);
  }

  /**
   * Validates a region + key pair by attempting to mint a token. When called
   * without a key (e.g. the renderer sent a masked value), falls back to the
   * stored key.
   */
  async testConnection(input?: { region?: string; apiKey?: string }): Promise<AzureSpeechTestResult> {
    let region = input?.region;
    let apiKey = input?.apiKey;
    if (!region || !apiKey) {
      const stored = await this.load();
      region = region ?? stored?.region;
      apiKey = apiKey ?? stored?.apiKey;
    }
    if (!region) return { ok: false, error: 'Region is required' };
    if (!apiKey) return { ok: false, error: 'Subscription key is required' };
    try {
      await this.issueToken(region, apiKey);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: getErrorMessage(err) };
    }
  }

  private async issueToken(region: string, apiKey: string): Promise<AzureSpeechToken> {
    if (!REGION_RE.test(region)) {
      throw new Error(`Invalid Azure region: ${region}`);
    }
    const url = `https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`;
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': apiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': '0',
      },
    });
    if (!res.ok) {
      throw new Error(`Token request failed with status ${res.status}`);
    }
    const token = await res.text();
    if (!token) throw new Error('Token request returned an empty token');
    return { token, region, expiresAt: this.now() + TOKEN_TTL_MS };
  }

  private async writeConfig(config: AzureSpeechConfig): Promise<void> {
    await fs.promises.mkdir(this.storeDir, { recursive: true });
    const tempPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    const data = JSON.stringify(stripKey(config), null, 2);
    const fh = await fs.promises.open(tempPath, 'w');
    try {
      await fh.writeFile(data, 'utf-8');
      await fh.sync();
    } finally {
      await fh.close();
    }
    await fs.promises.rename(tempPath, this.filePath);
  }

  private async loadKey(): Promise<string | undefined> {
    if (!this.credentials) return undefined;
    try {
      const credential = (await this.credentials.findCredentials(AZURE_SPEECH_CREDENTIAL_SERVICE))
        .find((entry) => entry.account === AZURE_SPEECH_CREDENTIAL_ACCOUNT);
      return credential?.password && credential.password.length > 0 ? credential.password : undefined;
    } catch (err) {
      throw new Error(`Failed to read Azure Speech key from credential store: ${getErrorMessage(err)}`, { cause: err });
    }
  }

  private async saveKey(apiKey: string): Promise<void> {
    if (!this.credentials) {
      throw new Error('Cannot save Azure Speech key without an OS credential store');
    }
    await this.credentials.setPassword(AZURE_SPEECH_CREDENTIAL_SERVICE, AZURE_SPEECH_CREDENTIAL_ACCOUNT, apiKey);
  }

  private async clearKey(): Promise<void> {
    if (!this.credentials) return;
    await this.credentials.deletePassword(AZURE_SPEECH_CREDENTIAL_SERVICE, AZURE_SPEECH_CREDENTIAL_ACCOUNT);
  }

  /** Validate, normalize, and strip unknown fields. Returns null if not coercible. */
  private coerce(input: unknown): AzureSpeechConfig | null {
    if (!input || typeof input !== 'object') return null;
    const raw = input as Record<string, unknown>;
    if (typeof raw.enabled !== 'boolean') return null;
    if (typeof raw.region !== 'string' || raw.region.length === 0) return null;
    const out: AzureSpeechConfig = {
      enabled: raw.enabled,
      region: raw.region,
    };
    if (typeof raw.sttLanguage === 'string' && raw.sttLanguage.length > 0) out.sttLanguage = raw.sttLanguage;
    if (typeof raw.ttsVoice === 'string' && raw.ttsVoice.length > 0) out.ttsVoice = raw.ttsVoice;
    return out;
  }
}

function stripKey(config: AzureSpeechConfig): AzureSpeechConfig {
  const nonSecret = { ...config };
  delete nonSecret.apiKey;
  return nonSecret;
}
