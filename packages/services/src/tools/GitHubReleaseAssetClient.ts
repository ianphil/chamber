import { listStoredGitHubCredentials, DEFAULT_USER_AGENT } from '../auth';
import type { CredentialStore } from '../ports';
import type { GitHubRegistryCredential, GitHubRegistryCredentialProvider } from '../genesis/GitHubRegistryClient';

export interface GitHubReleaseAssetClientOptions {
  fetch?: typeof fetch;
  credentialProvider?: GitHubRegistryCredentialProvider;
  requestTimeoutMs?: number;
  userAgent?: string;
}

export interface DownloadReleaseAssetRequest {
  owner: string;
  repo: string;
  tag: string;
  assetName: string;
}

export interface DownloadedReleaseAsset {
  assetName: string;
  bytes: Buffer;
}

interface GitHubReleaseResponse {
  assets: unknown;
}

export class GitHubReleaseAssetClient {
  private readonly fetchImpl: typeof fetch;
  private readonly credentialProvider: GitHubRegistryCredentialProvider;
  private readonly requestTimeoutMs: number;
  private readonly userAgent: string;

  constructor(options: GitHubReleaseAssetClientOptions = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.credentialProvider = options.credentialProvider ?? (() => Promise.resolve([]));
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  }

  static withCredentialStore(credentials: CredentialStore, userAgent?: string): GitHubReleaseAssetClient {
    return new GitHubReleaseAssetClient({
      credentialProvider: async () => (await listStoredGitHubCredentials(credentials))
        .map((credential) => ({ login: credential.login, token: credential.password })),
      userAgent,
    });
  }

  async downloadAsset(request: DownloadReleaseAssetRequest): Promise<DownloadedReleaseAsset> {
    const release = await this.requestJson<GitHubReleaseResponse>(
      releasePath(request.owner, request.repo, request.tag),
      request.owner,
      request.repo,
    );
    if (!Array.isArray(release.assets)) {
      throw new Error(`GitHub release ${request.tag} in ${request.owner}/${request.repo} did not include assets`);
    }
    const assets = release.assets.map(parseReleaseAsset);
    const asset = assets.find((entry) => entry.name === request.assetName);
    if (!asset) {
      throw new Error(`Release ${request.tag} in ${request.owner}/${request.repo} does not include asset ${request.assetName}`);
    }
    const bytes = await this.downloadAssetById(request.owner, request.repo, asset.id);
    return { assetName: asset.name, bytes };
  }

  private async requestJson<T>(pathAndQuery: string, owner: string, repo: string): Promise<T> {
    const anonymousAttempt = await this.fetchJsonAttempt<T>(pathAndQuery, null, null, owner, repo);
    if (anonymousAttempt.ok) return anonymousAttempt.value;

    let lastError = anonymousAttempt.error;
    for (const credential of await this.safeCredentials()) {
      const credentialAttempt = await this.fetchJsonAttempt<T>(pathAndQuery, credential.token, credential.login, owner, repo);
      if (credentialAttempt.ok) return credentialAttempt.value;
      lastError = credentialAttempt.error;
    }

    throw lastError ?? new Error('GitHub release request failed');
  }

  private async fetchJsonAttempt<T>(
    pathAndQuery: string,
    token: string | null,
    login: string | null,
    owner: string,
    repo: string,
  ): Promise<{ ok: true; value: T } | { ok: false; error: Error }> {
    const response = await this.fetchWithTimeout(`https://api.github.com${pathAndQuery}`, {
      headers: this.jsonHeaders(token),
    });
    if (response.ok) {
      return { ok: true, value: await response.json() as T };
    }
    return { ok: false, error: await githubRequestError(response, login, owner, repo) };
  }

  private async downloadAssetById(owner: string, repo: string, assetId: number): Promise<Buffer> {
    const pathAndQuery = `/repos/${encodePath(owner)}/${encodePath(repo)}/releases/assets/${assetId}`;
    const anonymousAttempt = await this.downloadAssetAttempt(pathAndQuery, null, null, owner, repo);
    if (anonymousAttempt.ok) return anonymousAttempt.value;

    let lastError = anonymousAttempt.error;
    for (const credential of await this.safeCredentials()) {
      const credentialAttempt = await this.downloadAssetAttempt(pathAndQuery, credential.token, credential.login, owner, repo);
      if (credentialAttempt.ok) return credentialAttempt.value;
      lastError = credentialAttempt.error;
    }
    throw lastError ?? new Error('GitHub release asset download failed');
  }

  private async downloadAssetAttempt(
    pathAndQuery: string,
    token: string | null,
    login: string | null,
    owner: string,
    repo: string,
  ): Promise<{ ok: true; value: Buffer } | { ok: false; error: Error }> {
    const response = await this.fetchWithTimeout(`https://api.github.com${pathAndQuery}`, {
      headers: this.assetHeaders(token),
      redirect: 'manual',
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        return { ok: false, error: new Error(`GitHub release asset redirect for ${owner}/${repo} did not include a location`) };
      }
      const redirected = await this.fetchWithTimeout(location, {
        headers: { 'User-Agent': this.userAgent },
      });
      if (!redirected.ok) {
        return { ok: false, error: await githubRequestError(redirected, null, owner, repo) };
      }
      return { ok: true, value: Buffer.from(await redirected.arrayBuffer()) };
    }
    if (response.ok) {
      return { ok: true, value: Buffer.from(await response.arrayBuffer()) };
    }
    return { ok: false, error: await githubRequestError(response, login, owner, repo) };
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), this.requestTimeoutMs);
    try {
      return await this.fetchImpl(url, { ...init, signal: abort.signal });
    } catch (error) {
      throw new Error(`GitHub release request failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async safeCredentials(): Promise<GitHubRegistryCredential[]> {
    try {
      return await this.credentialProvider();
    } catch {
      return [];
    }
  }

  private jsonHeaders(token: string | null): HeadersInit {
    return {
      'Accept': 'application/vnd.github+json',
      'User-Agent': this.userAgent,
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    };
  }

  private assetHeaders(token: string | null): HeadersInit {
    return {
      'Accept': 'application/octet-stream',
      'User-Agent': this.userAgent,
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    };
  }
}

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

function releasePath(owner: string, repo: string, tag: string): string {
  if (tag === 'latest') {
    return `/repos/${encodePath(owner)}/${encodePath(repo)}/releases/latest`;
  }
  return `/repos/${encodePath(owner)}/${encodePath(repo)}/releases/tags/${encodePath(tag)}`;
}

async function githubRequestError(response: Response, login: string | null, owner: string, repo: string): Promise<Error> {
  const message = await response.text().catch(() => '');
  const account = login ? ` using stored credential "${login}"` : ' anonymously';
  const accessHint = response.status === 401 || response.status === 403 || response.status === 404
    ? ` Check that you are signed in to GitHub with access to ${owner}/${repo}.`
    : '';
  return new Error(`GitHub release request failed${account}: ${response.status} ${response.statusText}${message ? ` - ${message}` : ''}.${accessHint}`);
}

function parseReleaseAsset(value: unknown): { id: number; name: string } {
  if (!isRecord(value) || typeof value.id !== 'number' || typeof value.name !== 'string') {
    throw new Error('GitHub release response included an invalid asset');
  }
  return { id: value.id, name: value.name };
}

function encodePath(value: string): string {
  return encodeURIComponent(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
