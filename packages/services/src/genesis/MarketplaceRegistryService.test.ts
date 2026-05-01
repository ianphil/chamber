import { describe, expect, it, beforeEach } from 'vitest';
import { MarketplaceRegistryService } from './MarketplaceRegistryService';
import type { AppConfig } from '@chamber/shared/types';
import type { TreeEntry } from './GitHubRegistryClient';

class FakeRegistryClient {
  fail = false;
  malformedManifest = false;
  missingRequiredFile = false;

  async fetchTree(): Promise<TreeEntry[]> {
    if (this.fail) throw new Error('not found');
    const tree = [
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
    return this.missingRequiredFile
      ? tree.filter((entry) => entry.path !== 'plugins/genesis-minds/minds/donna/SOUL.md')
      : tree;
  }

  async fetchJsonContent(_owner: string, _repo: string, filePath: string): Promise<unknown> {
    if (filePath.endsWith('plugin.json')) {
      return { name: 'genesis-minds', minds: [{ id: 'donna', manifest: 'minds/donna/mind.json' }] };
    }
    if (this.malformedManifest) {
      return {
        id: 'donna',
        displayName: 'Donna',
      };
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

class FakeGitHubAuthInspector {
  activeLogin: string | null = 'ianphil';

  async getActiveLogin(): Promise<string | null> {
    return this.activeLogin;
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
  let authInspector: FakeGitHubAuthInspector;
  let savedConfigs: AppConfig[];
  let save: (next: AppConfig) => void;

  beforeEach(() => {
    config = structuredClone(defaultConfig);
    registryClient = new FakeRegistryClient();
    authInspector = new FakeGitHubAuthInspector();
    savedConfigs = [];
    save = (next: AppConfig) => {
      savedConfigs.push(next);
      config = next;
    };
  });

  it('adds a GitHub Genesis marketplace registry after validating its manifest', async () => {
    const service = new MarketplaceRegistryService({ load: () => config, save }, registryClient, authInspector);

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
    const service = new MarketplaceRegistryService({ load: () => config, save }, registryClient, authInspector);

    await expect(service.addGenesisRegistry('https://github.com/agency-microsoft/genesis-minds')).resolves.toEqual({
      success: false,
      error: 'Unable to access marketplace agency-microsoft/genesis-minds with the active GitHub CLI account "ianphil". Chamber uses the GitHub CLI to read marketplace repositories. Run "gh auth status --hostname github.com" to confirm the active account, then run "gh auth switch --user <account-with-access>" or "gh auth login" before trying again.',
    });
    expect(savedConfigs).toHaveLength(0);
  });

  it('returns GitHub CLI setup guidance when no active account can be detected', async () => {
    registryClient.fail = true;
    authInspector.activeLogin = null;
    const service = new MarketplaceRegistryService({ load: () => config, save }, registryClient, authInspector);

    await expect(service.addGenesisRegistry('https://github.com/agency-microsoft/genesis-minds')).resolves.toEqual({
      success: false,
      error: 'Unable to access marketplace agency-microsoft/genesis-minds. Chamber uses the GitHub CLI to read marketplace repositories. Run "gh auth status --hostname github.com" to confirm the active account, then run "gh auth switch --user <account-with-access>" or "gh auth login" before trying again.',
    });
  });

  it('returns a manifest validation error without saving malformed marketplaces', async () => {
    registryClient.malformedManifest = true;
    const service = new MarketplaceRegistryService({ load: () => config, save }, registryClient, authInspector);

    await expect(service.addGenesisRegistry('https://github.com/agency-microsoft/genesis-minds')).resolves.toEqual({
      success: false,
      error: 'Marketplace agency-microsoft/genesis-minds is invalid: Template manifest plugins/genesis-minds/minds/donna/mind.json must define string field: description',
    });
    expect(savedConfigs).toHaveLength(0);
  });

  it('returns a manifest validation error when required template files are missing', async () => {
    registryClient.missingRequiredFile = true;
    const service = new MarketplaceRegistryService({ load: () => config, save }, registryClient, authInspector);

    await expect(service.refreshGenesisRegistry('github:ianphil/genesis-minds')).resolves.toEqual({
      success: false,
      error: 'Marketplace Public Genesis Minds is invalid: Marketplace missing required file: plugins/genesis-minds/minds/donna/SOUL.md',
    });
  });

  it('rejects non-GitHub URLs', async () => {
    const service = new MarketplaceRegistryService({ load: () => config, save }, registryClient, authInspector);

    await expect(service.addGenesisRegistry('https://example.com/agency-microsoft/genesis-minds')).resolves.toEqual({
      success: false,
      error: 'Marketplace URLs must point to github.com repositories.',
    });
  });

  it('rejects owner and repo path segments with shell metacharacters before validation', async () => {
    const service = new MarketplaceRegistryService({ load: () => config, save }, registryClient, authInspector);

    await expect(service.addGenesisRegistry('https://github.com/agency-microsoft/genesis-minds&calc')).resolves.toEqual({
      success: false,
      error: 'Marketplace URLs must include a valid GitHub owner and repository name.',
    });
    expect(savedConfigs).toHaveLength(0);
  });

  it('disables, enables, and removes followed marketplaces', async () => {
    const service = new MarketplaceRegistryService({ load: () => config, save }, registryClient, authInspector);
    await service.addGenesisRegistry('https://github.com/agency-microsoft/genesis-minds');

    expect(service.setGenesisRegistryEnabled('github:agency-microsoft/genesis-minds', false)).toEqual({
      success: true,
      registry: expect.objectContaining({ id: 'github:agency-microsoft/genesis-minds', enabled: false }),
    });
    expect(service.setGenesisRegistryEnabled('github:agency-microsoft/genesis-minds', true)).toEqual({
      success: true,
      registry: expect.objectContaining({ id: 'github:agency-microsoft/genesis-minds', enabled: true }),
    });
    expect(service.removeGenesisRegistry('github:agency-microsoft/genesis-minds')).toEqual({
      success: true,
      registry: expect.objectContaining({ id: 'github:agency-microsoft/genesis-minds' }),
    });
    expect(config.marketplaceRegistries).toHaveLength(1);
  });

  it('rejects invalid enabled state without mutating config', () => {
    const service = new MarketplaceRegistryService({ load: () => config, save }, registryClient, authInspector);

    expect(service.setGenesisRegistryEnabled('github:ianphil/genesis-minds', 'false')).toEqual({
      success: false,
      error: 'Marketplace enabled state must be a boolean.',
    });
    expect(savedConfigs).toHaveLength(0);
  });

  it('does not remove the default marketplace', () => {
    const service = new MarketplaceRegistryService({ load: () => config, save }, registryClient, authInspector);

    expect(service.removeGenesisRegistry('github:ianphil/genesis-minds')).toEqual({
      success: false,
      error: 'The default marketplace cannot be removed.',
    });
  });

  it('refreshes a followed marketplace by validating access', async () => {
    const service = new MarketplaceRegistryService({ load: () => config, save }, registryClient, authInspector);

    await expect(service.refreshGenesisRegistry('github:ianphil/genesis-minds')).resolves.toEqual({
      success: true,
      registry: expect.objectContaining({ id: 'github:ianphil/genesis-minds' }),
    });
  });
});
