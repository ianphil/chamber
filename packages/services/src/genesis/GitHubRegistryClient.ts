import { AuthService, listStoredGitHubCredentials } from '../auth';
import type { CredentialStore } from '../ports';

export interface TreeEntry {
  path: string;
  type: string;
  sha: string;
}

export interface GitHubRegistryCredential {
  login: string;
  token: string;
}

export type GitHubRegistryCredentialProvider = () => Promise<GitHubRegistryCredential[]>;

export interface GitHubRegistryClientOptions {
  fetch?: typeof fetch;
  credentialProvider?: GitHubRegistryCredentialProvider;
  requestTimeoutMs?: number;
  maxBlobBytes?: number;
}

interface GitHubTreeResponse {
  tree: unknown;
}

interface GitHubBlobResponse {
  content: unknown;
}

interface GitHubContentResponse {
  content: unknown;
}

export class GitHubRegistryClient {
  private readonly fetchImpl: typeof fetch;
  private readonly credentialProvider: GitHubRegistryCredentialProvider;
  private readonly requestTimeoutMs: number;
  private readonly maxBlobBytes: number;

  constructor(options: GitHubRegistryClientOptions = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.credentialProvider = options.credentialProvider ?? (() => Promise.resolve([]));
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.maxBlobBytes = options.maxBlobBytes ?? DEFAULT_MAX_BLOB_BYTES;
  }

  static withCredentialStore(credentials: CredentialStore): GitHubRegistryClient {
    return new GitHubRegistryClient({
      credentialProvider: async () => (await listStoredGitHubCredentials(credentials))
        .map((credential) => ({ login: credential.login, token: credential.password })),
    });
  }

  async fetchTree(owner: string, repo: string, branch: string): Promise<TreeEntry[]> {
    const response = await this.requestJson<GitHubTreeResponse>(
      `/repos/${encodePath(owner)}/${encodePath(repo)}/git/trees/${encodePath(branch)}?recursive=1`,
    );
    if (!Array.isArray(response.tree)) {
      throw new Error(`GitHub tree response for ${owner}/${repo} did not include a tree array`);
    }
    return response.tree.map(parseTreeEntry);
  }

  async fetchBlob(owner: string, repo: string, sha: string): Promise<Buffer> {
    const response = await this.requestJson<GitHubBlobResponse>(
      `/repos/${encodePath(owner)}/${encodePath(repo)}/git/blobs/${encodePath(sha)}`,
    );
    if (typeof response.content !== 'string') {
      throw new Error(`GitHub blob response for ${owner}/${repo}@${sha} did not include content`);
    }
    const encodedContent = response.content.replace(/\s/g, '');
    if (encodedContent.length > maxBase64Length(this.maxBlobBytes)) {
      throw new Error(`GitHub blob ${owner}/${repo}@${sha} exceeds the ${this.maxBlobBytes} byte limit`);
    }
    const content = Buffer.from(encodedContent, 'base64');
    if (content.length > this.maxBlobBytes) {
      throw new Error(`GitHub blob ${owner}/${repo}@${sha} exceeds the ${this.maxBlobBytes} byte limit`);
    }
    return content;
  }

  async fetchJsonContent(owner: string, repo: string, filePath: string, ref: string): Promise<unknown> {
    const response = await this.requestJson<GitHubContentResponse>(
      `/repos/${encodePath(owner)}/${encodePath(repo)}/contents/${encodeFilePath(filePath)}?ref=${encodePath(ref)}`,
    );
    if (typeof response.content !== 'string') {
      throw new Error(`GitHub content response for ${owner}/${repo}/${filePath} did not include content`);
    }
    return JSON.parse(Buffer.from(response.content, 'base64').toString('utf8'));
  }

  private async requestJson<T>(pathAndQuery: string): Promise<T> {
    const anonymousAttempt = await this.fetchJsonAttempt<T>(pathAndQuery, null, null);
    if (anonymousAttempt.ok) {
      return anonymousAttempt.value;
    }

    let lastError = anonymousAttempt.error;
    for (const credential of await this.safeCredentials()) {
      const credentialAttempt = await this.fetchJsonAttempt<T>(pathAndQuery, credential.token, credential.login);
      if (credentialAttempt.ok) {
        return credentialAttempt.value;
      }
      lastError = credentialAttempt.error;
    }

    throw lastError ?? new Error('GitHub API request failed');
  }

  private async fetchJsonAttempt<T>(
    pathAndQuery: string,
    token: string | null,
    login: string | null,
  ): Promise<{ ok: true; value: T } | { ok: false; error: Error }> {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), this.requestTimeoutMs);
    try {
      const response = await this.fetchImpl(`https://api.github.com${pathAndQuery}`, {
        headers: requestHeaders(token),
        signal: abort.signal,
      });
      if (response.ok) {
        return { ok: true, value: await response.json() as T };
      }
      return { ok: false, error: await registryRequestError(response, login) };
    } catch (error) {
      const account = login ? ` using stored credential "${login}"` : ' anonymously';
      return {
        ok: false,
        error: new Error(`GitHub API request failed${account}: ${error instanceof Error ? error.message : String(error)}`),
      };
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
}

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BLOB_BYTES = 10 * 1024 * 1024;

function requestHeaders(token: string | null): HeadersInit {
  return {
    'Accept': 'application/vnd.github+json',
    'User-Agent': AuthService.userAgent,
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
  };
}

function maxBase64Length(maxBytes: number): number {
  return Math.ceil(maxBytes / 3) * 4;
}

async function registryRequestError(response: Response, login: string | null): Promise<Error> {
  const message = await response.text().catch(() => '');
  const account = login ? ` using stored credential "${login}"` : ' anonymously';
  return new Error(`GitHub API request failed${account}: ${response.status} ${response.statusText}${message ? ` - ${message}` : ''}`);
}

function parseTreeEntry(value: unknown): TreeEntry {
  if (!isRecord(value)
    || typeof value.path !== 'string'
    || typeof value.type !== 'string'
    || typeof value.sha !== 'string') {
    throw new Error('GitHub tree response included an invalid entry');
  }
  return {
    path: value.path,
    type: value.type,
    sha: value.sha,
  };
}

function encodeFilePath(filePath: string): string {
  return filePath.split('/').map(encodePath).join('/');
}

function encodePath(value: string): string {
  return encodeURIComponent(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
