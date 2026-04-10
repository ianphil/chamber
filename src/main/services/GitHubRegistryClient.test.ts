import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubRegistryClient } from './GitHubRegistryClient';

describe('GitHubRegistryClient', () => {
  const fakeExec = vi.fn();
  let client: GitHubRegistryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new GitHubRegistryClient(fakeExec);
  });

  describe('fetchTree', () => {
    it('calls gh api with correct URL', () => {
      fakeExec.mockReturnValue(JSON.stringify({ tree: [] }));
      client.fetchTree('ianphil', 'genesis', 'main');
      expect(fakeExec).toHaveBeenCalledWith(
        expect.stringContaining('/repos/ianphil/genesis/git/trees/main'),
        expect.any(Object),
      );
    });

    it('returns parsed tree entries', () => {
      fakeExec.mockReturnValue(JSON.stringify({
        tree: [{ path: '.github/skills/upgrade/SKILL.md', type: 'blob', sha: 'abc123' }],
      }));
      const result = client.fetchTree('ianphil', 'genesis', 'main');
      expect(result).toHaveLength(1);
      expect(result[0].sha).toBe('abc123');
    });
  });

  describe('fetchBlob', () => {
    it('decodes base64 content', () => {
      fakeExec.mockReturnValue(JSON.stringify({
        content: Buffer.from('Hello World').toString('base64'),
        encoding: 'base64',
      }));
      const content = client.fetchBlob('ianphil', 'genesis', 'abc123');
      expect(content.toString()).toBe('Hello World');
    });
  });

  describe('fetchJsonContent', () => {
    it('fetches and parses JSON from repo contents API', () => {
      fakeExec.mockReturnValue(JSON.stringify({
        content: Buffer.from(JSON.stringify({ version: '1.0.0' })).toString('base64'),
      }));
      const result = client.fetchJsonContent('ianphil', 'genesis', '.github/registry.json', 'main');
      expect(result).toEqual({ version: '1.0.0' });
    });
  });
});
