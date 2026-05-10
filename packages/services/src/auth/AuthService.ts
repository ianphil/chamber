// AuthService — GitHub device flow + Copilot CLI credential storage via keytar.
// Stores the token in the exact Windows credential shape the CLI reads.

import * as https from 'https';
import type { CredentialStore } from '../ports';
import { Logger } from '../logger';

const log = Logger.create('Auth');

const CLIENT_ID = 'Ov23ctDVkRmgkPke0Mmm';
const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const AUTH_SCOPE = 'read:user,read:org,repo,gist';
// The previous CredWrite-based implementation used the same service/account shape,
// so existing Windows credentials remain readable after the switch to keytar.
export const GITHUB_CREDENTIAL_SERVICE = 'copilot-cli';
export const GITHUB_ACCOUNT_PREFIX = 'https://github.com:';
export const DEFAULT_USER_AGENT = 'Chamber';

export interface StoredGitHubCredential {
  login: string;
  account: string;
  password: string;
}

export function getCredentialAccount(login: string): string {
  return `${GITHUB_ACCOUNT_PREFIX}${login}`;
}

export function getLoginFromAccount(account: string): string | null {
  if (!account.startsWith(GITHUB_ACCOUNT_PREFIX)) return null;
  const login = account.slice(GITHUB_ACCOUNT_PREFIX.length).trim();
  return login || null;
}

export async function listStoredGitHubCredentials(credentials: CredentialStore): Promise<StoredGitHubCredential[]> {
  return (await credentials.findCredentials(GITHUB_CREDENTIAL_SERVICE))
    .map((credential) => {
      const login = getLoginFromAccount(credential.account);
      if (!login || !credential.password) return null;
      return { login, account: credential.account, password: credential.password };
    })
    .filter((credential): credential is StoredGitHubCredential => credential !== null)
    .sort((a, b) => a.login.localeCompare(b.login));
}

export interface AuthProgress {
  step: 'device_code' | 'polling' | 'authenticated' | 'error';
  userCode?: string;
  verificationUri?: string;
  login?: string;
  error?: string;
}

export interface StartLoginOptions {
  onProgress?: (progress: AuthProgress) => void;
  signal?: AbortSignal;
}

function postJson(url: string, body: Record<string, string>, userAgent: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname,
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'User-Agent': userAgent,
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk: string) => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error(`Invalid JSON: ${body}`)); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function getJson(url: string, token: string, userAgent: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`,
        'User-Agent': userAgent,
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk: string) => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error(`Invalid JSON: ${body}`)); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

export class AuthService {
  private readonly userAgent: string;

  constructor(
    private readonly credentials: CredentialStore,
    private readonly getActiveLogin: () => string | null = () => null,
    readonly setActiveLogin: (login: string | null) => void = () => undefined,
    userAgent: string = DEFAULT_USER_AGENT,
  ) {
    this.userAgent = userAgent;
  }

  async listAccounts(): Promise<Array<{ login: string }>> {
    try {
      return (await this.getStoredCredentials()).map(({ login }) => ({ login }));
    } catch (err) {
      log.error('Failed to list stored credentials:', err);
      return [];
    }
  }

  async getStoredCredential(): Promise<{ login: string } | null> {
    try {
      const credential = await this.getStoredCredentialEntry();
      return credential ? { login: credential.login } : null;
    } catch (err) {
      log.error('Failed to read stored credential:', err);
    }

    return null;
  }

  async logout(): Promise<void> {
    try {
      const credential = await this.getStoredCredentialEntry();
      if (!credential) return;
      await this.credentials.deletePassword(GITHUB_CREDENTIAL_SERVICE, credential.account);
      this.setActiveLogin(null);
      log.info(`Deleted credential for ${credential.login}`);
    } catch (err) {
      log.error('Failed to delete credential:', err);
    }
  }

  private async getStoredCredentials(): Promise<StoredGitHubCredential[]> {
    return listStoredGitHubCredentials(this.credentials);
  }

  private async getStoredCredentialEntry(): Promise<StoredGitHubCredential | null> {
    const credentials = await this.getStoredCredentials();
    if (credentials.length === 0) return null;

    const activeLogin = this.getActiveLogin();
    if (activeLogin === null) {
      if (credentials.length > 1) {
        log.warn(`Multiple Copilot credentials found; using ${credentials[0].account}`);
      }
      return credentials[0];
    }

    return credentials.find((credential) => credential.login === activeLogin) ?? null;
  }

  private async storeCredential(login: string, token: string): Promise<void> {
    await this.credentials.setPassword(GITHUB_CREDENTIAL_SERVICE, getCredentialAccount(login), token);
    log.info(`Stored credential for ${login} via keytar`);
  }

  async startLogin(options: StartLoginOptions = {}): Promise<{ success: boolean; login?: string }> {
    const { onProgress, signal } = options;
    const isAborted = (): boolean => signal?.aborted === true;

    // Honor an already-aborted signal as a clean no-op so the public contract
    // is "an aborted signal at entry never makes a network request."
    if (isAborted()) return { success: false };

    try {
      // 1. Start device flow
      const deviceResp = await postJson(DEVICE_CODE_URL, {
        client_id: CLIENT_ID,
        scope: AUTH_SCOPE,
      }, this.userAgent);

      const userCode = String(deviceResp.user_code);
      const verificationUri = String(deviceResp.verification_uri_complete ?? deviceResp.verification_uri);
      const deviceCode = String(deviceResp.device_code);
      let interval = Number(deviceResp.interval) || 5;
      const expiresIn = Number(deviceResp.expires_in) || 900;

      onProgress?.({ step: 'device_code', userCode, verificationUri });

      // 2. Poll for access token
      onProgress?.({ step: 'polling', userCode, verificationUri });
      const deadline = Date.now() + expiresIn * 1000;

      while (Date.now() < deadline && !isAborted()) {
        await new Promise(r => setTimeout(r, interval * 1000));
        if (isAborted()) return { success: false };

        const tokenResp = await postJson(ACCESS_TOKEN_URL, {
          client_id: CLIENT_ID,
          device_code: deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }, this.userAgent);

        if (tokenResp.access_token) {
          const token = String(tokenResp.access_token);

          // Get user login
          let login = 'user';
          try {
            const user = await getJson('https://api.github.com/user', token, this.userAgent);
            login = String(user.login);
          } catch (err) {
            log.warn('Failed to fetch user login, using default account name:', err);
          }

          await this.storeCredential(login, token);

          onProgress?.({ step: 'authenticated', login });
          return { success: true, login };
        }

        const error = String(tokenResp.error || '');
        if (error === 'authorization_pending') continue;
        if (error === 'slow_down') {
          interval += 5;
          continue;
        }

        onProgress?.({ step: 'error', error: `Auth failed: ${error}` });
        return { success: false };
      }

      if (isAborted()) return { success: false };
      onProgress?.({ step: 'error', error: 'Timed out waiting for authorization' });
      return { success: false };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      onProgress?.({ step: 'error', error: message });
      return { success: false };
    }
  }
}
