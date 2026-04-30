import { describe, it, expect, beforeEach } from 'vitest';
import { GenesisMindTemplateCatalog } from './GenesisMindTemplateCatalog';
import type { TreeEntry } from './GitHubRegistryClient';

class FakeRegistryClient {
  tree: TreeEntry[] = [];
  json = new Map<string, unknown>();

  fetchTree(): TreeEntry[] {
    return this.tree;
  }

  fetchJsonContent(_owner: string, _repo: string, filePath: string): unknown {
    const content = this.json.get(filePath);
    if (!content) throw new Error(`Missing JSON fixture for ${filePath}`);
    return content;
  }
}

describe('GenesisMindTemplateCatalog', () => {
  let registryClient: FakeRegistryClient;

  beforeEach(() => {
    registryClient = new FakeRegistryClient();
    seedLucyMarketplace(registryClient);
  });

  it('discovers templates from the default genesis minds marketplace', () => {
    const catalog = new GenesisMindTemplateCatalog(registryClient);

    expect(catalog.listTemplates()).toEqual([
      expect.objectContaining({
        id: 'lucy',
        displayName: 'Lucy',
        description: 'A calm Chief of Staff mind.',
        role: 'Chief of Staff',
        voice: 'Vanilla, calm, helpful, and precise',
        templateVersion: '0.1.0',
        source: expect.objectContaining({
          owner: 'ianphil',
          repo: 'genesis-minds',
          ref: 'master',
          plugin: 'genesis-minds',
          manifestPath: 'plugins/genesis-minds/minds/lucy/mind.json',
          rootPath: 'plugins/genesis-minds/minds/lucy',
          marketplaceId: 'github:ianphil/genesis-minds',
          marketplaceLabel: 'Public Genesis Minds',
          marketplaceUrl: 'https://github.com/ianphil/genesis-minds',
        }),
        requiredFiles: [
          'SOUL.md',
          'mind-index.md',
          '.github/agents/lucy.agent.md',
          '.working-memory/memory.md',
          '.working-memory/rules.md',
          '.working-memory/log.md',
        ],
      }),
    ]);
  });

  it('throws when a plugin entry points at a missing mind manifest', () => {
    registryClient.tree = registryClient.tree.filter((entry) => entry.path !== 'plugins/genesis-minds/minds/lucy/mind.json');

    const catalog = new GenesisMindTemplateCatalog(registryClient);

    expect(() => catalog.listTemplates()).toThrow('Template manifest not found: plugins/genesis-minds/minds/lucy/mind.json');
  });

  it('throws when a required template file is missing', () => {
    registryClient.tree = registryClient.tree.filter((entry) => entry.path !== 'plugins/genesis-minds/minds/lucy/SOUL.md');

    const catalog = new GenesisMindTemplateCatalog(registryClient);

    expect(() => catalog.listTemplates()).toThrow('Template lucy is missing required file: SOUL.md');
  });

  it('rejects template paths that escape the mind root', () => {
    registryClient.json.set('plugins/genesis-minds/minds/lucy/mind.json', {
      ...lucyManifest(),
      requiredFiles: ['../escape.md'],
    });
    registryClient.tree.push({ path: 'plugins/genesis-minds/minds/escape.md', type: 'blob', sha: 'escape' });

    const catalog = new GenesisMindTemplateCatalog(registryClient);

    expect(() => catalog.listTemplates()).toThrow('Template lucy has unsafe required file path: ../escape.md');
  });
});

function seedLucyMarketplace(registryClient: FakeRegistryClient): void {
  registryClient.tree = [
    { path: 'marketplace-config.json', type: 'blob', sha: 'marketplace' },
    { path: 'plugins/genesis-minds/plugin.json', type: 'blob', sha: 'plugin' },
    { path: 'plugins/genesis-minds/agency.json', type: 'blob', sha: 'agency' },
    { path: 'plugins/genesis-minds/minds/lucy/mind.json', type: 'blob', sha: 'manifest' },
    { path: 'plugins/genesis-minds/minds/lucy/SOUL.md', type: 'blob', sha: 'soul' },
    { path: 'plugins/genesis-minds/minds/lucy/mind-index.md', type: 'blob', sha: 'index' },
    { path: 'plugins/genesis-minds/minds/lucy/.github/agents/lucy.agent.md', type: 'blob', sha: 'agent' },
    { path: 'plugins/genesis-minds/minds/lucy/.working-memory/memory.md', type: 'blob', sha: 'memory' },
    { path: 'plugins/genesis-minds/minds/lucy/.working-memory/rules.md', type: 'blob', sha: 'rules' },
    { path: 'plugins/genesis-minds/minds/lucy/.working-memory/log.md', type: 'blob', sha: 'log' },
  ];
  registryClient.json.set('plugins/genesis-minds/plugin.json', {
    name: 'genesis-minds',
    minds: [{ id: 'lucy', manifest: 'minds/lucy/mind.json' }],
  });
  registryClient.json.set('plugins/genesis-minds/minds/lucy/mind.json', lucyManifest());
}

function lucyManifest(): Record<string, unknown> {
  return {
    id: 'lucy',
    displayName: 'Lucy',
    description: 'A calm Chief of Staff mind.',
    role: 'Chief of Staff',
    voice: 'Vanilla, calm, helpful, and precise',
    templateVersion: '0.1.0',
    root: '.',
    agent: '.github/agents/lucy.agent.md',
    requiredFiles: [
      'SOUL.md',
      'mind-index.md',
      '.github/agents/lucy.agent.md',
      '.working-memory/memory.md',
      '.working-memory/rules.md',
      '.working-memory/log.md',
    ],
  };
}
