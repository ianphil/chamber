import { describe, it, expect, beforeEach } from 'vitest';
import { GenesisMindTemplateMarketplaceCatalog } from './GenesisMindTemplateMarketplaceCatalog';
import type { TreeEntry } from './GitHubRegistryClient';
import type { GenesisMindTemplateMarketplaceSource } from './templateTypes';

class FakeRegistryClient {
  tree = new Map<string, TreeEntry[]>();
  json = new Map<string, unknown>();
  failingRepos = new Set<string>();

  fetchTree(owner: string, repo: string): TreeEntry[] {
    const key = repoKey(owner, repo);
    if (this.failingRepos.has(key)) {
      throw new Error('GitHub repository not found');
    }
    return this.tree.get(key) ?? [];
  }

  fetchJsonContent(owner: string, repo: string, filePath: string): unknown {
    const content = this.json.get(`${repoKey(owner, repo)}:${filePath}`);
    if (!content) throw new Error(`Missing JSON fixture for ${filePath}`);
    return content;
  }
}

const publicSource: GenesisMindTemplateMarketplaceSource = {
  id: 'github:ianphil/genesis-minds',
  label: 'Public Genesis Minds',
  url: 'https://github.com/ianphil/genesis-minds',
  owner: 'ianphil',
  repo: 'genesis-minds',
  ref: 'master',
  plugin: 'genesis-minds',
  enabled: true,
  isDefault: true,
};

const internalSource: GenesisMindTemplateMarketplaceSource = {
  id: 'github:agency-microsoft/genesis-minds',
  label: 'Agency Microsoft',
  url: 'https://github.com/agency-microsoft/genesis-minds',
  owner: 'agency-microsoft',
  repo: 'genesis-minds',
  ref: 'main',
  plugin: 'genesis-minds',
  enabled: true,
  isDefault: false,
};

describe('GenesisMindTemplateMarketplaceCatalog', () => {
  let registryClient: FakeRegistryClient;

  beforeEach(() => {
    registryClient = new FakeRegistryClient();
    seedMarketplace(registryClient, publicSource, 'lucy', 'Lucy');
    seedMarketplace(registryClient, internalSource, 'donna', 'Donna');
  });

  it('aggregates templates from every enabled marketplace and labels their source', () => {
    const catalog = new GenesisMindTemplateMarketplaceCatalog(registryClient, [publicSource, internalSource]);

    expect(catalog.listTemplates()).toEqual({
      templates: [
        expect.objectContaining({
          id: 'lucy',
          displayName: 'Lucy',
          source: expect.objectContaining({
            marketplaceId: 'github:ianphil/genesis-minds',
            marketplaceLabel: 'Public Genesis Minds',
            marketplaceUrl: 'https://github.com/ianphil/genesis-minds',
          }),
        }),
        expect.objectContaining({
          id: 'donna',
          displayName: 'Donna',
          source: expect.objectContaining({
            marketplaceId: 'github:agency-microsoft/genesis-minds',
            marketplaceLabel: 'Agency Microsoft',
            marketplaceUrl: 'https://github.com/agency-microsoft/genesis-minds',
          }),
        }),
      ],
      sources: [
        expect.objectContaining({ id: 'github:ianphil/genesis-minds', status: 'ok', templateCount: 1 }),
        expect.objectContaining({ id: 'github:agency-microsoft/genesis-minds', status: 'ok', templateCount: 1 }),
      ],
    });
  });

  it('skips disabled marketplaces', () => {
    const catalog = new GenesisMindTemplateMarketplaceCatalog(registryClient, [
      publicSource,
      { ...internalSource, enabled: false },
    ]);

    expect(catalog.listTemplates()).toEqual({
      templates: [
        expect.objectContaining({ id: 'lucy' }),
      ],
      sources: [
        expect.objectContaining({ id: 'github:ianphil/genesis-minds', status: 'ok', templateCount: 1 }),
        expect.objectContaining({ id: 'github:agency-microsoft/genesis-minds', status: 'disabled', templateCount: 0 }),
      ],
    });
  });

  it('keeps accessible marketplace templates when a private source cannot be read', () => {
    registryClient.failingRepos.add(repoKey(internalSource.owner, internalSource.repo));
    const catalog = new GenesisMindTemplateMarketplaceCatalog(registryClient, [publicSource, internalSource]);

    expect(catalog.listTemplates()).toEqual({
      templates: [
        expect.objectContaining({ id: 'lucy' }),
      ],
      sources: [
        expect.objectContaining({ id: 'github:ianphil/genesis-minds', status: 'ok', templateCount: 1 }),
        expect.objectContaining({
          id: 'github:agency-microsoft/genesis-minds',
          status: 'error',
          templateCount: 0,
          message: 'Unable to access marketplace Agency Microsoft. Check your GitHub sign-in or repository access.',
        }),
      ],
    });
  });
});

function seedMarketplace(
  registryClient: FakeRegistryClient,
  source: GenesisMindTemplateMarketplaceSource,
  mindId: string,
  displayName: string,
): void {
  const key = repoKey(source.owner, source.repo);
  const manifestPath = `plugins/${source.plugin}/minds/${mindId}/mind.json`;
  registryClient.tree.set(key, [
    { path: 'marketplace-config.json', type: 'blob', sha: `${mindId}-marketplace` },
    { path: `plugins/${source.plugin}/plugin.json`, type: 'blob', sha: `${mindId}-plugin` },
    { path: manifestPath, type: 'blob', sha: `${mindId}-manifest` },
    { path: `plugins/${source.plugin}/minds/${mindId}/SOUL.md`, type: 'blob', sha: `${mindId}-soul` },
    { path: `plugins/${source.plugin}/minds/${mindId}/mind-index.md`, type: 'blob', sha: `${mindId}-index` },
    { path: `plugins/${source.plugin}/minds/${mindId}/.github/agents/${mindId}.agent.md`, type: 'blob', sha: `${mindId}-agent` },
    { path: `plugins/${source.plugin}/minds/${mindId}/.working-memory/memory.md`, type: 'blob', sha: `${mindId}-memory` },
    { path: `plugins/${source.plugin}/minds/${mindId}/.working-memory/rules.md`, type: 'blob', sha: `${mindId}-rules` },
    { path: `plugins/${source.plugin}/minds/${mindId}/.working-memory/log.md`, type: 'blob', sha: `${mindId}-log` },
  ]);
  registryClient.json.set(`${key}:plugins/${source.plugin}/plugin.json`, {
    name: source.plugin,
    minds: [{ id: mindId, manifest: `minds/${mindId}/mind.json` }],
  });
  registryClient.json.set(`${key}:${manifestPath}`, {
    id: mindId,
    displayName,
    description: `${displayName} description.`,
    role: 'Chief of Staff',
    voice: 'Calm and precise',
    templateVersion: '0.1.0',
    root: '.',
    agent: `.github/agents/${mindId}.agent.md`,
    requiredFiles: [
      'SOUL.md',
      'mind-index.md',
      `.github/agents/${mindId}.agent.md`,
      '.working-memory/memory.md',
      '.working-memory/rules.md',
      '.working-memory/log.md',
    ],
  });
}

function repoKey(owner: string, repo: string): string {
  return `${owner}/${repo}`;
}
