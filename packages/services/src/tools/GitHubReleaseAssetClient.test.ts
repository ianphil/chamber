import { describe, it, expect } from 'vitest';
import { GitHubReleaseAssetClient } from './GitHubReleaseAssetClient';

class FakeResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Headers;

  constructor(
    private readonly body: unknown,
    init: { status?: number; statusText?: string; headers?: Record<string, string> } = {},
  ) {
    this.status = init.status ?? 200;
    this.statusText = init.statusText ?? 'OK';
    this.ok = this.status >= 200 && this.status < 300;
    this.headers = new Headers(init.headers);
  }

  async json(): Promise<unknown> {
    return this.body;
  }

  async text(): Promise<string> {
    return typeof this.body === 'string' ? this.body : JSON.stringify(this.body);
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    if (this.body instanceof Uint8Array) {
      return this.body.buffer.slice(this.body.byteOffset, this.body.byteOffset + this.body.byteLength) as ArrayBuffer;
    }
    const encoded = new TextEncoder().encode(String(this.body));
    return encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer;
  }
}

function response(fake: FakeResponse): Response {
  return fake as unknown as Response;
}

describe('GitHubReleaseAssetClient', () => {
  it('downloads a tagged release asset using stored credentials and strips auth on redirect', async () => {
    const calls: Array<{ url: string; headers: Headers; redirect?: RequestRedirect }> = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      calls.push({
        url: String(url),
        headers: new Headers(init?.headers),
        redirect: init?.redirect,
      });
      if (String(url).includes('/releases/tags/v0.5.0')) {
        if (!new Headers(init?.headers).has('authorization')) {
          return response(new FakeResponse({ message: 'Not Found' }, { status: 404, statusText: 'Not Found' }));
        }
        return response(new FakeResponse({
          assets: [{ id: 123, name: 'teams.exe', digest: 'sha256:abc' }],
        }));
      }
      if (String(url).includes('/releases/assets/123')) {
        if (!new Headers(init?.headers).has('authorization')) {
          return response(new FakeResponse({ message: 'Not Found' }, { status: 404, statusText: 'Not Found' }));
        }
        return response(new FakeResponse('', {
          status: 302,
          statusText: 'Found',
          headers: { location: 'https://objects.example/teams.exe' },
        }));
      }
      if (String(url) === 'https://objects.example/teams.exe') {
        return response(new FakeResponse(new Uint8Array([1, 2, 3])));
      }
      throw new Error(`Unexpected URL: ${url}`);
    };
    const client = new GitHubReleaseAssetClient({
      fetch: fetchImpl as typeof fetch,
      credentialProvider: async () => [{ login: 'ianphil_microsoft', token: 'secret-token' }],
    });

    const result = await client.downloadAsset({
      owner: 'agency-microsoft',
      repo: 'a365-cli',
      tag: 'v0.5.0',
      assetName: 'teams.exe',
    });

    expect(result.bytes).toEqual(Buffer.from([1, 2, 3]));
    expect(result.assetName).toBe('teams.exe');
    expect(calls[0].headers.get('authorization')).toBeNull();
    expect(calls[1].headers.get('authorization')).toBe('Bearer secret-token');
    expect(calls[2].redirect).toBe('manual');
    expect(calls[2].headers.get('authorization')).toBeNull();
    expect(calls[3].redirect).toBe('manual');
    expect(calls[3].headers.get('authorization')).toBe('Bearer secret-token');
    expect(calls[4].headers.get('authorization')).toBeNull();
  });

  it('uses the latest release endpoint when tag is latest', async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: string | URL | Request): Promise<Response> => {
      urls.push(String(url));
      if (String(url).includes('/releases/latest')) {
        return response(new FakeResponse({ assets: [{ id: 1, name: 'mail.exe' }] }));
      }
      if (String(url).includes('/releases/assets/1')) {
        return response(new FakeResponse(new Uint8Array([4]), { status: 200 }));
      }
      throw new Error(`Unexpected URL: ${url}`);
    };
    const client = new GitHubReleaseAssetClient({ fetch: fetchImpl as typeof fetch });

    await client.downloadAsset({
      owner: 'agency-microsoft',
      repo: 'a365-cli',
      tag: 'latest',
      assetName: 'mail.exe',
    });

    expect(urls[0]).toContain('/repos/agency-microsoft/a365-cli/releases/latest');
  });

  it('reports a clear error when a release asset is missing', async () => {
    const client = new GitHubReleaseAssetClient({
      fetch: (async () => response(new FakeResponse({ assets: [{ id: 1, name: 'mail.exe' }] }))) as typeof fetch,
    });

    await expect(client.downloadAsset({
      owner: 'agency-microsoft',
      repo: 'a365-cli',
      tag: 'v0.5.0',
      assetName: 'teams.exe',
    })).rejects.toThrow('Release v0.5.0 in agency-microsoft/a365-cli does not include asset teams.exe');
  });

  it('surfaces private repository access guidance when GitHub returns not found', async () => {
    const client = new GitHubReleaseAssetClient({
      fetch: (async () => response(new FakeResponse({ message: 'Not Found' }, { status: 404, statusText: 'Not Found' }))) as typeof fetch,
    });

    await expect(client.downloadAsset({
      owner: 'agency-microsoft',
      repo: 'a365-cli',
      tag: 'v0.5.0',
      assetName: 'teams.exe',
    })).rejects.toThrow('Check that you are signed in to GitHub with access to agency-microsoft/a365-cli');
  });
});
