import { createHash, randomBytes as nodeRandomBytes, timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { A2ARelayAuthProvider } from './RelayA2ARegistryClient';

const TOKEN_REFRESH_SKEW_MS = 60_000;
const DEFAULT_LOGIN_TIMEOUT_MS = 120_000;

export interface EntraA2AAuthProviderOptions {
  clientId: string;
  tenantId?: string;
  scope?: string;
  fetchImpl?: typeof fetch;
  openExternal?: (url: string) => Promise<void>;
  waitForAuthorizationCode?: (state: string) => Promise<AuthorizationCodeResult>;
  randomBytes?: (size: number) => Buffer;
  now?: () => number;
  tokenCache?: EntraA2ATokenCache;
}

export interface EntraA2ATokenCacheEntry {
  refreshToken?: string;
}

export interface EntraA2ATokenCache {
  load(): Promise<EntraA2ATokenCacheEntry | null>;
  save(entry: EntraA2ATokenCacheEntry): Promise<void>;
  clear(): Promise<void>;
}

interface AuthorizationCodeResult {
  code: string | Promise<string>;
  redirectUri: string;
  dispose?: () => void;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

export class EntraA2AAuthProvider implements A2ARelayAuthProvider {
  #accessToken: string | null = null;
  #refreshToken: string | null = null;
  #accessTokenExpiresAt = 0;
  #tokenRequest: Promise<string> | null = null;
  private readonly tenantId: string;
  private readonly scope: string;
  private readonly fetchImpl: typeof fetch;
  private readonly openExternal: (url: string) => Promise<void>;
  private readonly waitForAuthorizationCode: (state: string) => Promise<AuthorizationCodeResult>;
  private readonly randomBytes: (size: number) => Buffer;
  private readonly now: () => number;
  private readonly tokenCache?: EntraA2ATokenCache;
  #cacheLoaded = false;

  constructor(options: EntraA2AAuthProviderOptions) {
    if (!options.clientId.trim()) throw new Error('Interactive A2A auth requires a client ID');
    this.tenantId = options.tenantId?.trim() || 'common';
    this.scope = options.scope?.trim() || `api://${options.clientId}/user_impersonation`;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.openExternal = options.openExternal ?? openExternalUrl;
    this.waitForAuthorizationCode = options.waitForAuthorizationCode ?? waitForAuthorizationCode;
    this.randomBytes = options.randomBytes ?? nodeRandomBytes;
    this.now = options.now ?? Date.now;
    this.tokenCache = options.tokenCache;
    this.clientId = options.clientId;
  }

  private readonly clientId: string;

  async getAuthorizationHeader(): Promise<string> {
    return `Bearer ${await this.ensureAccessToken()}`;
  }

  async invalidate(): Promise<void> {
    this.#accessToken = null;
    this.#refreshToken = null;
    this.#accessTokenExpiresAt = 0;
    await this.tokenCache?.clear();
  }

  private async ensureAccessToken(): Promise<string> {
    await this.loadCachedToken();
    if (this.#accessToken && this.#accessTokenExpiresAt - this.now() > TOKEN_REFRESH_SKEW_MS) {
      return this.#accessToken;
    }
    this.#tokenRequest ??= this.acquireToken().finally(() => {
      this.#tokenRequest = null;
    });
    return this.#tokenRequest;
  }

  private async acquireToken(): Promise<string> {
    if (this.#refreshToken) {
      try {
        return await this.refreshAccessToken();
      } catch {
        this.#refreshToken = null;
        await this.tokenCache?.clear();
      }
    }
    return this.interactiveLogin();
  }

  private async loadCachedToken(): Promise<void> {
    if (this.#cacheLoaded) return;
    this.#cacheLoaded = true;
    const cached = await this.tokenCache?.load();
    if (!cached) return;
    this.#refreshToken = cached.refreshToken?.trim() || null;
  }

  private async interactiveLogin(): Promise<string> {
    const verifier = base64Url(this.randomBytes(32));
    const challenge = base64Url(createHash('sha256').update(verifier).digest());
    const state = base64Url(this.randomBytes(24));
    const callback = await this.waitForAuthorizationCode(state);
    try {
      const authorizeUrl = this.createAuthorizeUrl(callback.redirectUri, challenge, state);
      await this.openExternal(authorizeUrl.toString());
      const code = await callback.code;
      const token = await this.exchangeToken({
        client_id: this.clientId,
        grant_type: 'authorization_code',
        code,
        redirect_uri: callback.redirectUri,
        code_verifier: verifier,
        scope: this.fullScope(),
      });
      return this.applyTokenResponse(token);
    } finally {
      callback.dispose?.();
    }
  }

  private async refreshAccessToken(): Promise<string> {
    const token = await this.exchangeToken({
      client_id: this.clientId,
      grant_type: 'refresh_token',
      refresh_token: this.#refreshToken ?? '',
      scope: this.fullScope(),
    });
    return this.applyTokenResponse(token);
  }

  private createAuthorizeUrl(redirectUri: string, challenge: string, state: string): URL {
    const url = new URL(`https://login.microsoftonline.com/${encodeURIComponent(this.tenantId)}/oauth2/v2.0/authorize`);
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_mode', 'query');
    url.searchParams.set('scope', this.fullScope());
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('state', state);
    return url;
  }

  private async exchangeToken(form: Record<string, string>): Promise<TokenResponse> {
    const response = await this.fetchImpl(
      `https://login.microsoftonline.com/${encodeURIComponent(this.tenantId)}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(form),
      },
    );
    const body = await response.json().catch(() => ({})) as TokenResponse;
    if (!response.ok) {
      throw new Error(`Switchboard token request failed: ${body.error_description ?? body.error ?? response.statusText}`);
    }
    return body;
  }

  private async applyTokenResponse(token: TokenResponse): Promise<string> {
    if (!token.access_token) {
      throw new Error('Switchboard token response did not include an access token.');
    }
    this.#accessToken = token.access_token;
    this.#refreshToken = token.refresh_token ?? this.#refreshToken;
    this.#accessTokenExpiresAt = this.now() + Number(token.expires_in ?? 3600) * 1_000;
    if (this.#refreshToken) {
      await this.tokenCache?.save({ refreshToken: this.#refreshToken });
    }
    return token.access_token;
  }

  private fullScope(): string {
    return `openid profile offline_access ${this.scope}`;
  }
}

function base64Url(buffer: Buffer): string {
  return buffer.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export async function waitForAuthorizationCode(expectedState: string): Promise<AuthorizationCodeResult> {
  const server = createServer();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const code = new Promise<string>((resolve, reject) => {
    server.on('request', (request, response) => {
      handleAuthorizationCallback(request, response, expectedState, resolve, reject);
      if (timeout) clearTimeout(timeout);
      server.close();
    });
    server.once('error', reject);
    timeout = setTimeout(() => {
      server.close();
      reject(new Error('Timed out waiting for interactive A2A login.'));
    }, DEFAULT_LOGIN_TIMEOUT_MS);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, 'localhost', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    code,
    redirectUri: `http://localhost:${port}`,
    dispose: () => {
      if (timeout) clearTimeout(timeout);
      server.close();
    },
  };
}

function handleAuthorizationCallback(
  request: IncomingMessage,
  response: ServerResponse,
  expectedState: string,
  resolve: (code: string) => void,
  reject: (error: Error) => void,
): void {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (url.pathname !== '/') {
    response.writeHead(404).end('Not found');
    return;
  }
  const state = url.searchParams.get('state') ?? '';
  if (!safeEqual(state, expectedState)) {
    response.writeHead(400).end('Invalid state');
    reject(new Error('Interactive A2A login returned an invalid state.'));
    return;
  }
  const error = url.searchParams.get('error');
  if (error) {
    response.writeHead(400).end('Login failed. You can close this tab.');
    reject(new Error(`${error}: ${url.searchParams.get('error_description') ?? 'login failed'}`));
    return;
  }
  const code = url.searchParams.get('code');
  if (!code) {
    response.writeHead(400).end('Missing code');
    reject(new Error('Interactive A2A login did not return an authorization code.'));
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end('<!doctype html><title>Switchboard login complete</title><p>Switchboard login complete. You can close this tab.</p>');
  resolve(code);
}

function safeEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function openExternalUrl(url: string): Promise<void> {
  const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  return new Promise((resolve) => {
    execFile(command, args, () => resolve());
  });
}
