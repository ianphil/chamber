// AuthService — GitHub device flow + Copilot CLI credential storage via keytar.
// Stores the token in the exact Windows credential shape the CLI reads.

import { app } from 'electron';
import * as https from 'https';
import { createRequire } from 'module';
import * as path from 'path';

const CLIENT_ID = 'Ov23ctDVkRmgkPke0Mmm';
const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const AUTH_SCOPE = 'read:user,read:org,repo,gist';
// The previous CredWrite-based implementation used the same service/account shape,
// so existing Windows credentials remain readable after the switch to keytar.
const KEYTAR_SERVICE = 'copilot-cli';
const GITHUB_ACCOUNT_PREFIX = 'https://github.com:';
const runtimeRequire = createRequire(__filename);

type KeytarModule = typeof import('keytar');

interface StoredCredential {
  login: string;
  account: string;
  password: string;
}

function loadKeytar(): KeytarModule {
  if (!app.isPackaged) {
    return runtimeRequire('keytar') as KeytarModule;
  }

  const packagedKeytarPath = path.join(process.resourcesPath, 'keytar', 'lib', 'keytar.js');
  return runtimeRequire(packagedKeytarPath) as KeytarModule;
}

const defaultKeytar = loadKeytar();

function getUserAgent(): string {
  return `Chamber/${app.getVersion()}`;
}

export function getCredentialAccount(login: string): string {
  return `${GITHUB_ACCOUNT_PREFIX}${login}`;
}

export function getLoginFromAccount(account: string): string | null {
  if (!account.startsWith(GITHUB_ACCOUNT_PREFIX)) return null;
  const login = account.slice(GITHUB_ACCOUNT_PREFIX.length).trim();
  return login || null;
}

export function resolveStoredCredential(credentials: Array<{ account: string; password: string }>): StoredCredential | null {
  const matchingCredentials = credentials
    .map((credential) => {
      const login = getLoginFromAccount(credential.account);
      if (!login || !credential.password) return null;
      return { login, account: credential.account, password: credential.password };
    })
    .filter((credential): credential is StoredCredential => credential !== null);

  if (matchingCredentials.length === 0) return null;

  if (matchingCredentials.length > 1) {
    console.warn(`[Auth] Multiple Copilot credentials found; using ${matchingCredentials[0].account}`);
  }

  return matchingCredentials[0];
}

export interface AuthProgress {
  step: 'device_code' | 'polling' | 'authenticated' | 'error';
  userCode?: string;
  verificationUri?: string;
  login?: string;
  error?: string;
}

function postJson(url: string, body: Record<string, string>): Promise<Record<string, unknown>> {
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
        'User-Agent': getUserAgent(),
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

function getJson(url: string, token: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`,
        'User-Agent': getUserAgent(),
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
  private onProgress?: (progress: AuthProgress) => void;
  private aborted = false;
  private keytar: KeytarModule;

  constructor(keytarModule?: KeytarModule) {
    this.keytar = keytarModule ?? defaultKeytar;
  }

  setProgressHandler(handler: (progress: AuthProgress) => void): void {
    this.onProgress = handler;
  }

  abort(): void {
    this.aborted = true;
  }

  async getStoredCredential(): Promise<{ login: string } | null> {
    try {
      const credential = resolveStoredCredential(await this.keytar.findCredentials(KEYTAR_SERVICE));
      return credential ? { login: credential.login } : null;
    } catch (err) {
      console.error('[Auth] Failed to read stored credential:', err);
    }

    return null;
  }

  async logout(): Promise<void> {
    this.abort();

    try {
      const credential = resolveStoredCredential(await this.keytar.findCredentials(KEYTAR_SERVICE));
      if (!credential) return;
      await this.keytar.deletePassword(KEYTAR_SERVICE, credential.account);
      console.log(`[Auth] Deleted credential for ${credential.login}`);
    } catch (err) {
      console.error('[Auth] Failed to delete credential:', err);
    }
  }

  private async storeCredential(login: string, token: string): Promise<void> {
    await this.keytar.setPassword(KEYTAR_SERVICE, getCredentialAccount(login), token);
    console.log(`[Auth] Stored credential for ${login} via keytar`);
  }

  async startLogin(): Promise<{ success: boolean; login?: string }> {
    this.aborted = false;

    try {
      // 1. Start device flow
      const deviceResp = await postJson(DEVICE_CODE_URL, {
        client_id: CLIENT_ID,
        scope: AUTH_SCOPE,
      });

      const userCode = String(deviceResp.user_code);
      const verificationUri = String(deviceResp.verification_uri);
      const deviceCode = String(deviceResp.device_code);
      let interval = Number(deviceResp.interval) || 5;
      const expiresIn = Number(deviceResp.expires_in) || 900;

      this.onProgress?.({ step: 'device_code', userCode, verificationUri });

      // 2. Poll for access token
      this.onProgress?.({ step: 'polling', userCode, verificationUri });
      const deadline = Date.now() + expiresIn * 1000;

      while (Date.now() < deadline && !this.aborted) {
        await new Promise(r => setTimeout(r, interval * 1000));
        if (this.aborted) return { success: false };

        const tokenResp = await postJson(ACCESS_TOKEN_URL, {
          client_id: CLIENT_ID,
          device_code: deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        });

        if (tokenResp.access_token) {
          const token = String(tokenResp.access_token);

          // Get user login
          let login = 'user';
          try {
            const user = await getJson('https://api.github.com/user', token);
            login = String(user.login);
          } catch (err) {
            console.warn('[Auth] Failed to fetch user login, using default account name:', err);
          }

          await this.storeCredential(login, token);

          this.onProgress?.({ step: 'authenticated', login });
          return { success: true, login };
        }

        const error = String(tokenResp.error || '');
        if (error === 'authorization_pending') continue;
        if (error === 'slow_down') {
          interval += 5;
          continue;
        }

        this.onProgress?.({ step: 'error', error: `Auth failed: ${error}` });
        return { success: false };
      }

      if (this.aborted) return { success: false };
      this.onProgress?.({ step: 'error', error: 'Timed out waiting for authorization' });
      return { success: false };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.onProgress?.({ step: 'error', error: message });
      return { success: false };
    }
  }
}
