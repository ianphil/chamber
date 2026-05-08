import { describe, it, expect, beforeEach } from 'vitest';
import { MarketplaceToolCatalog } from './MarketplaceToolCatalog';
import type { ToolMarketplaceSource } from './toolTypes';

class FakeRegistryClient {
  manifests = new Map<string, unknown>();
  async fetchTree(): Promise<never[]> { return []; }
  async fetchJsonContent(_owner: string, _repo: string, filePath: string): Promise<unknown> {
    if (!this.manifests.has(filePath)) {
      throw new Error(`No fake content for ${filePath}`);
    }
    return this.manifests.get(filePath);
  }
}

const SOURCE: ToolMarketplaceSource = {
  id: 'github:ianphil/genesis-minds',
  label: 'Public Genesis Minds',
  url: 'https://github.com/ianphil/genesis-minds',
  owner: 'ianphil',
  repo: 'genesis-minds',
  ref: 'master',
  plugin: 'genesis-minds',
  enabled: true,
};

describe('MarketplaceToolCatalog', () => {
  let client: FakeRegistryClient;

  beforeEach(() => {
    client = new FakeRegistryClient();
  });

  it('returns an empty list when the plugin omits the tools field', async () => {
    client.manifests.set('plugins/genesis-minds/plugin.json', { name: 'genesis-minds', minds: [] });
    const catalog = new MarketplaceToolCatalog(client, [SOURCE]);
    const result = await catalog.listTools();
    expect(result.tools).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('parses a well-formed tools entry', async () => {
    client.manifests.set('plugins/genesis-minds/plugin.json', {
      name: 'genesis-minds',
      tools: [
        {
          id: 'workiq',
          displayName: 'Microsoft Work IQ',
          description: 'Query M365 data.',
          install: { type: 'npm-global', package: '@microsoft/workiq', version: 'latest' },
          bin: 'workiq',
          help: 'workiq ask --help',
          preflight: ['workiq accept-eula'],
          agentInstructions: 'Use workiq ask.',
        },
      ],
    });
    const catalog = new MarketplaceToolCatalog(client, [SOURCE]);
    const result = await catalog.listTools();
    expect(result.errors).toEqual([]);
    expect(result.tools).toHaveLength(1);
    const tool = result.tools[0];
    expect(tool.id).toBe('workiq');
    expect(tool.install).toEqual({ type: 'npm-global', package: '@microsoft/workiq', version: 'latest' });
    expect(tool.preflight).toEqual(['workiq accept-eula']);
    expect(tool.source.marketplaceId).toBe('github:ianphil/genesis-minds');
  });

  it('skips disabled marketplaces', async () => {
    const catalog = new MarketplaceToolCatalog(client, [{ ...SOURCE, enabled: false }]);
    const result = await catalog.listTools();
    expect(result.tools).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('reports per-marketplace errors without aborting the catalog', async () => {
    client.manifests.set('plugins/genesis-minds/plugin.json', { tools: 'not-an-array' });
    const catalog = new MarketplaceToolCatalog(client, [SOURCE]);
    const result = await catalog.listTools();
    expect(result.tools).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].marketplaceId).toBe('github:ianphil/genesis-minds');
    expect(result.errors[0].message).toContain('non-array tools field');
  });

  it('rejects malformed tool entries', async () => {
    client.manifests.set('plugins/genesis-minds/plugin.json', {
      tools: [{ id: 'workiq', displayName: 'WorkIQ' }],
    });
    const catalog = new MarketplaceToolCatalog(client, [SOURCE]);
    const result = await catalog.listTools();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('description');
  });

  it('supports a function-style source provider', async () => {
    client.manifests.set('plugins/genesis-minds/plugin.json', { tools: [] });
    const catalog = new MarketplaceToolCatalog(client, () => [SOURCE]);
    const result = await catalog.listTools();
    expect(result.tools).toEqual([]);
  });
});
