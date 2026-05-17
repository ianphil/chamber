// ByoLlmStore — atomic file-backed persistence for the user's BYO LLM config.
//
// File: <storeDir>/byo-llm.json (defaults to ~/.chamber/byo-llm.json)
//
// Atomic write strategy: write to a sibling .tmp file, fsync, rename over the
// real file. Mirrors the safe-state pattern used elsewhere in chamber for
// settings and registries.
//
// Secrets (apiKey, bearerToken, customHeaders) are stored through the injected
// OS credential store. The JSON file stores only non-secret connection metadata.

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ByoLlmConfig } from '@chamber/shared/types';
import { Logger } from '../logger';
import type { CredentialStore } from '../ports';

const log = Logger.create('ByoLlmStore');
const FILE_NAME = 'byo-llm.json';
export const BYO_LLM_CREDENTIAL_SERVICE = 'chamber-byo-llm';
export const BYO_LLM_CREDENTIAL_ACCOUNT = 'default';

interface ByoLlmSecrets {
  apiKey?: string;
  bearerToken?: string;
  customHeaders?: Record<string, string>;
}

export interface ByoLlmStoreOptions {
  storeDir?: string;
  credentials?: CredentialStore;
}

export class ByoLlmStore {
  private readonly storeDir: string;
  private readonly filePath: string;
  private readonly credentials?: CredentialStore;

  constructor(options: ByoLlmStoreOptions = {}) {
    this.storeDir = options.storeDir ?? path.join(os.homedir(), '.chamber');
    this.filePath = path.join(this.storeDir, FILE_NAME);
    this.credentials = options.credentials;
  }

  getFilePath(): string {
    return this.filePath;
  }

  async load(): Promise<ByoLlmConfig | null> {
    try {
      const raw = await fs.promises.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as unknown;
      const config = this.coerce(parsed);
      if (!config) {
        log.warn(`Stored BYO LLM config at ${this.filePath} is invalid; ignoring.`);
        return null;
      }
      const diskSecrets = extractSecrets(config);
      const hasLegacySecrets = hasSecrets(diskSecrets);
      const credentialSecrets = await this.loadSecrets();
      if (hasLegacySecrets) {
        if (!hasSecrets(credentialSecrets)) {
          await this.saveSecrets(diskSecrets);
        }
        await this.writeConfig(stripSecrets(config));
      }
      return {
        ...stripSecrets(config),
        ...(hasSecrets(credentialSecrets) ? credentialSecrets : diskSecrets),
      };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') return null;
      log.warn(`Failed to read BYO LLM config from ${this.filePath}: ${stringifyError(err)}`);
      return null;
    }
  }

  async save(config: ByoLlmConfig): Promise<void> {
    const sanitized = this.coerce(config);
    if (!sanitized) {
      throw new Error('Refusing to save invalid BYO LLM config');
    }
    await this.saveSecrets(extractSecrets(sanitized));
    await this.writeConfig(stripSecrets(sanitized));
    log.info(`Saved BYO LLM config (${redactConfigForLog(sanitized)})`);
  }

  async clear(): Promise<void> {
    try {
      await fs.promises.unlink(this.filePath);
      await this.clearSecrets();
      log.info('Cleared BYO LLM config');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        await this.clearSecrets();
        return;
      }
      throw err;
    }
  }

  private async writeConfig(config: ByoLlmConfig): Promise<void> {
    await fs.promises.mkdir(this.storeDir, { recursive: true });
    const tempPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    const data = JSON.stringify(config, null, 2);
    const fh = await fs.promises.open(tempPath, 'w');
    try {
      await fh.writeFile(data, 'utf-8');
      await fh.sync();
    } finally {
      await fh.close();
    }
    await fs.promises.rename(tempPath, this.filePath);
  }

  private async loadSecrets(): Promise<ByoLlmSecrets> {
    if (!this.credentials) return {};
    try {
      const credential = (await this.credentials.findCredentials(BYO_LLM_CREDENTIAL_SERVICE))
        .find((entry) => entry.account === BYO_LLM_CREDENTIAL_ACCOUNT);
      if (!credential?.password) return {};
      const parsed = JSON.parse(credential.password) as unknown;
      return coerceSecrets(parsed);
    } catch (err) {
      throw new Error(`Failed to read BYO LLM secrets from credential store: ${stringifyError(err)}`, { cause: err });
    }
  }

  private async saveSecrets(secrets: ByoLlmSecrets): Promise<void> {
    if (!hasSecrets(secrets)) {
      await this.clearSecrets();
      return;
    }
    if (!this.credentials) {
      throw new Error('Cannot save BYO LLM secrets without an OS credential store');
    }
    await this.credentials.setPassword(
      BYO_LLM_CREDENTIAL_SERVICE,
      BYO_LLM_CREDENTIAL_ACCOUNT,
      JSON.stringify(secrets),
    );
  }

  private async clearSecrets(): Promise<void> {
    if (!this.credentials) return;
    await this.credentials.deletePassword(BYO_LLM_CREDENTIAL_SERVICE, BYO_LLM_CREDENTIAL_ACCOUNT);
  }

  /** Validate, normalize, and strip unknown fields. Returns null if not coercible. */
  private coerce(input: unknown): ByoLlmConfig | null {
    if (!input || typeof input !== 'object') return null;
    const raw = input as Record<string, unknown>;
    if (typeof raw.enabled !== 'boolean') return null;
    if (typeof raw.baseUrl !== 'string') return null;
    if (hasUrlCredentials(raw.baseUrl)) {
      throw new Error('Refusing to save BYO LLM config: baseUrl must not contain URL credentials (user:password@). Use the API key or bearer token field instead.');
    }

    const out: ByoLlmConfig = {
      enabled: raw.enabled,
      baseUrl: raw.baseUrl,
    };

    if (raw.providerType === 'openai' || raw.providerType === 'azure' || raw.providerType === 'anthropic') {
      out.providerType = raw.providerType;
    }
    if (typeof raw.apiKey === 'string') out.apiKey = raw.apiKey;
    if (typeof raw.bearerToken === 'string') out.bearerToken = raw.bearerToken;
    if (typeof raw.model === 'string') out.model = raw.model;
    if (typeof raw.modelId === 'string') out.modelId = raw.modelId;
    if (typeof raw.wireModel === 'string') out.wireModel = raw.wireModel;
    if (raw.wireApi === 'completions' || raw.wireApi === 'responses') out.wireApi = raw.wireApi;
    if (typeof raw.azureApiVersion === 'string') out.azureApiVersion = raw.azureApiVersion;
    if (raw.customHeaders && typeof raw.customHeaders === 'object' && !Array.isArray(raw.customHeaders)) {
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(raw.customHeaders)) {
        if (typeof v === 'string') {
          // Reject CR/LF in header names and values to prevent response-splitting /
          // header-injection (defense-in-depth — Node usually rejects, but the
          // store-layer guard makes the contract explicit).
          if (/[\r\n]/.test(k) || /[\r\n]/.test(v)) {
            throw new Error('Refusing to save BYO LLM config: custom header names and values must not contain CR or LF characters.');
          }
          headers[k] = v;
        }
      }
      if (Object.keys(headers).length > 0) out.customHeaders = headers;
    }
    if (typeof raw.maxPromptTokens === 'number' && Number.isFinite(raw.maxPromptTokens)) {
      out.maxPromptTokens = raw.maxPromptTokens;
    }
    if (typeof raw.maxOutputTokens === 'number' && Number.isFinite(raw.maxOutputTokens)) {
      out.maxOutputTokens = raw.maxOutputTokens;
    }
    return out;
  }
}

/** Returns a string suitable for logging — never includes secret values. */
export function redactConfigForLog(config: ByoLlmConfig): string {
  const parts: string[] = [
    `enabled=${config.enabled}`,
    `baseUrl=${redactUrlCredentials(config.baseUrl)}`,
    `providerType=${config.providerType ?? 'openai'}`,
  ];
  if (config.apiKey) parts.push('apiKey=<redacted>');
  if (config.bearerToken) parts.push('bearerToken=<redacted>');
  if (config.model) parts.push(`model=${config.model}`);
  if (config.modelId) parts.push(`modelId=${config.modelId}`);
  if (config.wireModel) parts.push(`wireModel=${config.wireModel}`);
  if (config.azureApiVersion) parts.push(`azureApiVersion=${config.azureApiVersion}`);
  if (config.customHeaders && Object.keys(config.customHeaders).length > 0) {
    parts.push(`customHeaders=<${Object.keys(config.customHeaders).length} keys, redacted>`);
  }
  return parts.join(' ');
}

/**
 * Returns true when the given URL string contains an embedded userinfo
 * component (e.g. https://user:pass@host/v1). Such credentials must never
 * be persisted or logged — Chamber routes auth through the apiKey /
 * bearerToken / customHeaders fields instead.
 */
export function hasUrlCredentials(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return parsed.username.length > 0 || parsed.password.length > 0;
  } catch {
    return false;
  }
}

/**
 * Strips any userinfo from the given URL string. Returns the original
 * string unchanged when it does not parse as a URL — callers should
 * already have rejected credential-bearing URLs at the persistence
 * boundary, but this remains safe for log/IPC paths.
 */
export function redactUrlCredentials(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.username.length === 0 && parsed.password.length === 0) {
      return rawUrl;
    }
    parsed.username = '';
    parsed.password = '';
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

function stringifyError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function stripSecrets(config: ByoLlmConfig): ByoLlmConfig {
  const nonSecret = { ...config };
  delete nonSecret.apiKey;
  delete nonSecret.bearerToken;
  delete nonSecret.customHeaders;
  return nonSecret;
}

function extractSecrets(config: ByoLlmConfig): ByoLlmSecrets {
  const secrets: ByoLlmSecrets = {};
  if (config.apiKey && config.apiKey.length > 0) secrets.apiKey = config.apiKey;
  if (config.bearerToken && config.bearerToken.length > 0) secrets.bearerToken = config.bearerToken;
  if (config.customHeaders && Object.keys(config.customHeaders).length > 0) {
    secrets.customHeaders = config.customHeaders;
  }
  return secrets;
}

function hasSecrets(secrets: ByoLlmSecrets): boolean {
  return Boolean(secrets.apiKey || secrets.bearerToken || (secrets.customHeaders && Object.keys(secrets.customHeaders).length > 0));
}

function coerceSecrets(input: unknown): ByoLlmSecrets {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const raw = input as Record<string, unknown>;
  const secrets: ByoLlmSecrets = {};
  if (typeof raw.apiKey === 'string' && raw.apiKey.length > 0) secrets.apiKey = raw.apiKey;
  if (typeof raw.bearerToken === 'string' && raw.bearerToken.length > 0) secrets.bearerToken = raw.bearerToken;
  if (raw.customHeaders && typeof raw.customHeaders === 'object' && !Array.isArray(raw.customHeaders)) {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw.customHeaders)) {
      if (typeof v === 'string' && v.length > 0) headers[k] = v;
    }
    if (Object.keys(headers).length > 0) secrets.customHeaders = headers;
  }
  return secrets;
}
