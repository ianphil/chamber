import { describe, expect, it, beforeEach } from 'vitest';
import { MarketplaceRegistryService } from './MarketplaceRegistryService';
import type { AppConfig } from '@chamber/shared/types';
import type { TreeEntry } from './GitHubRegistryClient';

class FakeRegistryClient {
  fail = false;

  async fetchTree(): Promise<TreeEntry[]> {
    if (this.fail) throw new Error('not found');
    return [
      { path: 'marketplace-config.json', type: 'blob', sha: 'marketplace' },
      { path: 'plugins/genesis-minds/plugin.json', type: 'blob', sha: 'plugin' },
      { path: 'plugins/genesis-minds/minds/donna/mind.json', type: 'blob', sha: 'manifest' },
      { path: 'plugins/genesis-minds/minds/donna/SOUL.md', type: 'blob', sha: 'soul' },
      { path: 'plugins/genesis-minds/minds/donna/mind-index.md', type: 'blob', sha: 'index' },
      { path: 'plugins/genesis-minds/minds/donna/.github/agents/donna.agent.md', type: 'blob', sha: 'agent' },
      { path: 'plugins/genesis-minds/minds/donna/.working-memory/memory.md', type: 'blob', sha: 'memory' },
      { path: 'plugins/genesis-minds/minds/donna/.working-memory/rules.md', type: 'blob', sha: 'rules' },
      { path: 'plugins/genesis-minds/minds/donna/.working-memory/log.md', type: 'blob', sha: 'log' },
    ];
  }

  async fetchJsonContent(_owner: string, _repo: string, filePath: string): Promise<unknown> {
    if (filePath.endsWith('plugin.json')) {
      return { name: 'genesis-minds', minds: [{ id: 'donna', manifest: 'minds/donna/mind.json' }] };
    }
    return {
      id: 'donna',
      displayName: 'Donna',
      description: 'Internal chief of staff.',
      role: 'Chief of Staff',
      voice: 'Direct and precise',
      templateVersion: '0.1.0',
      root: '.',
      agent: '.github/agents/donna.agent.md',
      requiredFiles: [
        'SOUL.md',
        'mind-index.md',
        '.github/agents/donna.agent.md',
        '.working-memory/memory.md',
        '.working-memory/rules.md',
        '.working-memory/log.md',
      ],
    };
  }
}

const defaultConfig: AppConfig = {
  version: 2,
  minds: [],
  activeMindId: null,
  activeLogin: null,
  theme: 'dark',
  marketplaceRegistries: [
    {
      id: 'github:ianphil/genesis-minds',
      label: 'Public Genesis Minds',
      url: 'https://github.com/ianphil/genesis-minds',
      owner: 'ianphil',
      repo: 'genesis-minds',
      ref: 'master',
      plugin: 'genesis-minds',
      enabled: true,
      isDefault: true,
    },
  ],
};

describe('MarketplaceRegistryService', () => {
  let config: AppConfig;
  let registryClient: FakeRegistryClient;
  let savedConfigs: AppConfig[];
  let save: (next: AppConfig) => void;

  beforeEach(() => {
    config = structuredClone(defaultConfig);
    registryClient = new FakeRegistryClient();
    savedConfigs = [];
    save = (next: AppConfig) => {
      savedConfigs.push(next);
      config = next;
    };
  });

  it('adds a GitHub Genesis marketplace registry after validating its manifest', async () => {
    const service = new MarketplaceRegistryService({ load: () => config, save }, registryClient);

    await expect(service.addGenesisRegistry('https://github.com/agency-microsoft/genesis-minds')).resolves.toEqual({
      success: true,
      registry: {
        id: 'github:agency-microsoft/genesis-minds',
        label: 'agency-microsoft/genesis-minds',
        url: 'https://github.com/agency-microsoft/genesis-minds',
        owner: 'agency-microsoft',
        repo: 'genesis-minds',
        ref: 'main',
        plugin: 'genesis-minds',
        enabled: true,
        isDefault: false,
      },
    });
    expect(config.marketplaceRegistries).toHaveLength(2);
  });

  it('returns a friendly access error without saving inaccessible marketplaces', async () => {
    registryClient.fail = true;
    const service = new MarketplaceRegistryService({ load: () => config, save }, registryClient);

    await expect(service.addGenesisRegistry('https://github.com/agency-microsoft/genesis-minds')).resolves.toEqual({
      success: false,
      error: 'Unable to access marketplace agency-microsoft/genesis-minds. Check your GitHub sign-in or repository access.',
    });
    expect(savedConfigs).toHaveLength(0);
  });

  it('rejects non-GitHub URLs', async () => {
    const service = new MarketplaceRegistryService({ load: () => config, save }, registryClient);

    await expect(service.addGenesisRegistry('https://example.com/agency-microsoft/genesis-minds')).resolves.toEqual({
      success: false,
      error: 'Marketplace URLs must point to github.com repositories.',
    });
  });

  it('rejects owner and repo path segments with shell metacharacters before validation', async () => {
    const service = new MarketplaceRegistryService({ load: () => config, save }, registryClient);

    await expect(service.addGenesisRegistry('https://github.com/agency-microsoft/genesis-minds&calc')).resolves.toEqual({
      success: false,
      error: 'Marketplace URLs must include a valid GitHub owner and repository name.',
    });
    expect(savedConfigs).toHaveLength(0);
  });
});
