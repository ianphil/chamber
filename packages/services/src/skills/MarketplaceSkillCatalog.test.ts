import { describe, it, expect, beforeEach } from 'vitest';
import type { TreeEntry } from '../genesis/GitHubRegistryClient';
import { MarketplaceSkillCatalog } from './MarketplaceSkillCatalog';
import type { SkillMarketplaceSource } from './skillTypes';

class FakeRegistryClient {
  trees = new Map<string, TreeEntry[]>();
  manifests = new Map<string, unknown>();

  async fetchTree(owner: string, repo: string): Promise<TreeEntry[]> {
    return this.trees.get(repoKey(owner, repo)) ?? [];
  }

  async fetchJsonContent(_owner: string, _repo: string, filePath: string): Promise<unknown> {
    if (!this.manifests.has(filePath)) {
      throw new Error(`No fake content for ${filePath}`);
    }
    return this.manifests.get(filePath);
  }
}

const DEFAULT_SOURCE: SkillMarketplaceSource = {
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

const TEAM_SOURCE: SkillMarketplaceSource = {
  id: 'github:contoso/genesis-minds',
  label: 'Contoso',
  url: 'https://github.com/contoso/genesis-minds',
  owner: 'contoso',
  repo: 'genesis-minds',
  ref: 'main',
  plugin: 'genesis-minds',
  enabled: true,
  isDefault: false,
};

describe('MarketplaceSkillCatalog', () => {
  let client: FakeRegistryClient;

  beforeEach(() => {
    client = new FakeRegistryClient();
    seedTree(client, DEFAULT_SOURCE, 'automation', ['SKILL.md', 'examples/briefing-with-canvas.ts']);
  });

  it('returns an empty list when the plugin omits the skills field', async () => {
    client.manifests.set('plugins/genesis-minds/plugin.json', { name: 'genesis-minds', minds: [] });

    const catalog = new MarketplaceSkillCatalog(client, [DEFAULT_SOURCE]);
    const result = await catalog.listSkills();

    expect(result.skills).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('parses well-formed skills with source metadata', async () => {
    seedPlugin(client, [{
      id: 'automation',
      displayName: 'Chamber Automation',
      description: 'Create and schedule Chamber automation scripts.',
      root: 'skills/automation',
      requiredFiles: ['SKILL.md', 'examples/briefing-with-canvas.ts'],
      capabilities: ['chamber-automation', 'cron-scripts', 'ttasks-runtime'],
    }]);

    const catalog = new MarketplaceSkillCatalog(client, [DEFAULT_SOURCE]);
    const result = await catalog.listSkills();

    expect(result.errors).toEqual([]);
    expect(result.skills).toEqual([
      {
        id: 'automation',
        displayName: 'Chamber Automation',
        description: 'Create and schedule Chamber automation scripts.',
        root: 'skills/automation',
        requiredFiles: ['SKILL.md', 'examples/briefing-with-canvas.ts'],
        capabilities: ['chamber-automation', 'cron-scripts', 'ttasks-runtime'],
        reserved: true,
        source: {
          owner: 'ianphil',
          repo: 'genesis-minds',
          ref: 'master',
          plugin: 'genesis-minds',
          marketplaceId: 'github:ianphil/genesis-minds',
          marketplaceLabel: 'Public Genesis Minds',
          marketplaceUrl: 'https://github.com/ianphil/genesis-minds',
          isDefault: true,
        },
      },
    ]);
  });

  it('rejects unsafe roots and required files', async () => {
    seedPlugin(client, [{
      id: 'automation',
      displayName: 'Chamber Automation',
      description: 'Bad paths.',
      root: '../skills/automation',
      requiredFiles: ['SKILL.md'],
      capabilities: [],
    }]);

    const catalog = new MarketplaceSkillCatalog(client, [DEFAULT_SOURCE]);
    const result = await catalog.listSkills();

    expect(result.skills).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('root must be a safe relative path');
  });

  it('requires declared skill files to exist in the marketplace tree', async () => {
    seedPlugin(client, [{
      id: 'automation',
      displayName: 'Chamber Automation',
      description: 'Create automation.',
      root: 'skills/automation',
      requiredFiles: ['SKILL.md', 'missing.md'],
      capabilities: [],
    }]);

    const catalog = new MarketplaceSkillCatalog(client, [DEFAULT_SOURCE]);
    const result = await catalog.listSkills();

    expect(result.skills).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('missing required file: missing.md');
  });

  it('skips disabled marketplaces', async () => {
    const catalog = new MarketplaceSkillCatalog(client, [{ ...DEFAULT_SOURCE, enabled: false }]);
    const result = await catalog.listSkills();

    expect(result.skills).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('reports per-marketplace errors without aborting other marketplaces', async () => {
    seedPlugin(client, 'not-an-array');
    seedTree(client, TEAM_SOURCE, 'team-skill', ['SKILL.md']);
    client.manifests.set('plugins/genesis-minds/plugin.json', {
      skills: [{
        id: 'team-skill',
        displayName: 'Team Skill',
        description: 'Team guidance.',
        root: 'skills/team-skill',
        requiredFiles: ['SKILL.md'],
        capabilities: ['team-guidance'],
      }],
    });
    client.manifests.set('plugins/broken/plugin.json', { skills: 'not-an-array' });

    const catalog = new MarketplaceSkillCatalog(client, [
      { ...DEFAULT_SOURCE, plugin: 'broken' },
      TEAM_SOURCE,
    ]);
    const result = await catalog.listSkills();

    expect(result.skills.map((skill) => skill.id)).toEqual(['team-skill']);
    expect(result.errors).toEqual([
      expect.objectContaining({
        marketplaceId: 'github:ianphil/genesis-minds',
        message: expect.stringContaining('non-array skills field'),
      }),
    ]);
  });

  it('does not allow non-default marketplaces to provide reserved core skills', async () => {
    seedTree(client, TEAM_SOURCE, 'automation', ['SKILL.md']);
    client.manifests.set('plugins/genesis-minds/plugin.json', {
      skills: [{
        id: 'automation',
        displayName: 'Fake Automation',
        description: 'Override Chamber automation.',
        root: 'skills/automation',
        requiredFiles: ['SKILL.md'],
        capabilities: ['override'],
      }],
    });

    const catalog = new MarketplaceSkillCatalog(client, [TEAM_SOURCE]);
    const result = await catalog.listSkills();

    expect(result.skills).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('reserved core skill');
  });
});

function seedPlugin(client: FakeRegistryClient, skills: unknown): void {
  client.manifests.set('plugins/genesis-minds/plugin.json', {
    name: 'genesis-minds',
    skills,
  });
}

function seedTree(
  client: FakeRegistryClient,
  source: SkillMarketplaceSource,
  skillId: string,
  files: string[],
): void {
  client.trees.set(repoKey(source.owner, source.repo), files.map((file) => ({
    path: `plugins/${source.plugin}/skills/${skillId}/${file}`,
    type: 'blob',
    sha: `${skillId}-${file}`,
  })));
}

function repoKey(owner: string, repo: string): string {
  return `${owner}/${repo}`;
}
