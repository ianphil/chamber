import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubRegistryClient } from './GitHubRegistryClient';

describe('GitHubRegistryClient', () => {
  const fetchMock = vi.fn<typeof fetch>();
  let client: GitHubRegistryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new GitHubRegistryClient({ fetch: fetchMock });
  });

  describe('fetchTree', () => {
    it('fetches the GitHub REST tree endpoint without requiring gh', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ tree: [] }));

      await client.fetchTree('ianphil', 'genesis', 'main');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.github.com/repos/ianphil/genesis/git/trees/main?recursive=1',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Accept': 'application/vnd.github+json',
            'User-Agent': expect.any(String),
          }),
          signal: expect.any(AbortSignal),
        }),
      );
    });

    it('returns parsed tree entries', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({
        tree: [{ path: '.github/skills/upgrade/SKILL.md', type: 'blob', sha: 'abc123' }],
      }));

      const result = await client.fetchTree('ianphil', 'genesis', 'main');

      expect(result).toHaveLength(1);
      expect(result[0].sha).toBe('abc123');
    });

    it('falls back to stored credentials when anonymous access fails', async () => {
      client = new GitHubRegistryClient({
        fetch: fetchMock,
        credentialProvider: async () => [{ login: 'ianphil_microsoft', token: 'secret-token' }],
      });
      fetchMock
        .mockResolvedValueOnce(new Response('not found', { status: 404, statusText: 'Not Found' }))
        .mockResolvedValueOnce(jsonResponse({ tree: [] }));

      await client.fetchTree('agency-microsoft', 'genesis-minds', 'main');

      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        'https://api.github.com/repos/agency-microsoft/genesis-minds/git/trees/main?recursive=1',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer secret-token',
          }),
        }),
      );
    });

    it('does not read stored credentials when anonymous access succeeds', async () => {
      const credentialProvider = vi.fn(async () => [{ login: 'ianphil_microsoft', token: 'secret-token' }]);
      client = new GitHubRegistryClient({ fetch: fetchMock, credentialProvider });
      fetchMock.mockResolvedValueOnce(jsonResponse({ tree: [] }));

      await client.fetchTree('ianphil', 'genesis-minds', 'master');

      expect(credentialProvider).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('keeps the anonymous error when credential lookup fails', async () => {
      client = new GitHubRegistryClient({
        fetch: fetchMock,
        credentialProvider: async () => {
          throw new Error('keychain locked');
        },
      });
      fetchMock.mockResolvedValueOnce(new Response('not found', { status: 404, statusText: 'Not Found' }));

      await expect(client.fetchTree('agency-microsoft', 'genesis-minds', 'main'))
        .rejects.toThrow('GitHub API request failed anonymously: 404 Not Found');
    });
  });

  describe('fetchBlob', () => {
    it('decodes base64 content', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({
        content: Buffer.from('Hello World').toString('base64'),
        encoding: 'base64',
      }));

      const content = await client.fetchBlob('ianphil', 'genesis', 'abc123');

      expect(content.toString()).toBe('Hello World');
    });

    it('rejects blobs over the configured size limit', async () => {
      client = new GitHubRegistryClient({ fetch: fetchMock, maxBlobBytes: 4 });
      fetchMock.mockResolvedValueOnce(jsonResponse({
        content: Buffer.from('Hello').toString('base64'),
        encoding: 'base64',
      }));

      await expect(client.fetchBlob('ianphil', 'genesis', 'abc123'))
        .rejects.toThrow('exceeds the 4 byte limit');
    });
  });

  describe('fetchJsonContent', () => {
    it('fetches and parses JSON from repo contents API', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({
        content: Buffer.from(JSON.stringify({ version: '1.0.0' })).toString('base64'),
      }));

      const result = await client.fetchJsonContent('ianphil', 'genesis', '.github/registry.json', 'main');

      expect(result).toEqual({ version: '1.0.0' });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.github.com/repos/ianphil/genesis/contents/.github/registry.json?ref=main',
        expect.any(Object),
      );
    });
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
