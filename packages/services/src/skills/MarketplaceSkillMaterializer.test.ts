import { createHash } from 'node:crypto';
import { describe, it, expect, beforeEach } from 'vitest';
import type { TreeEntry } from '../genesis/GitHubRegistryClient';
import { MarketplaceSkillMaterializer } from './MarketplaceSkillMaterializer';
import type { MarketplaceSkillEntry } from './skillTypes';

class FakeRegistryClient {
  tree: TreeEntry[] = [];
  blobs = new Map<string, Buffer>();

  async fetchTree(): Promise<TreeEntry[]> {
    return this.tree;
  }

  async fetchBlob(_owner: string, _repo: string, sha: string): Promise<Buffer> {
    const blob = this.blobs.get(sha);
    if (!blob) throw new Error(`No fake blob for ${sha}`);
    return Buffer.from(blob);
  }
}

const SKILL: MarketplaceSkillEntry = {
  id: 'automation',
  displayName: 'Chamber Automation',
  description: 'Create automation.',
  root: 'skills/automation',
  requiredFiles: ['SKILL.md'],
  capabilities: ['chamber-automation'],
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
};

describe('MarketplaceSkillMaterializer', () => {
  let client: FakeRegistryClient;

  beforeEach(() => {
    client = new FakeRegistryClient();
  });

  it('materializes all files under the skill root using frontmatter as the version source', async () => {
    seedBlob(client, 'plugins/genesis-minds/skills/automation/examples/example.ts', 'example-sha', 'console.log("hi");');
    seedBlob(client, 'plugins/genesis-minds/skills/automation/SKILL.md', 'skill-sha', [
      '---',
      'name: automation',
      'version: 2.2.0',
      'description: Create automation.',
      '---',
      '# Automation',
    ].join('\n'));

    const materializer = new MarketplaceSkillMaterializer(client);
    const asset = await materializer.materialize(SKILL);

    expect(asset.manifest).toEqual({
      name: 'automation',
      version: '2.2.0',
      capabilities: ['chamber-automation'],
    });
    expect(asset.files.map((file) => file.path)).toEqual([
      'SKILL.md',
      'examples/example.ts',
    ]);
    expect(asset.files[0].sha256).toBe(managedSha256('SKILL.md', asset.files[0].content));
    expect(asset.source).toEqual({
      type: 'marketplace',
      marketplaceId: 'github:ianphil/genesis-minds',
      marketplaceLabel: 'Public Genesis Minds',
      marketplaceUrl: 'https://github.com/ianphil/genesis-minds',
      owner: 'ianphil',
      repo: 'genesis-minds',
      ref: 'master',
      plugin: 'genesis-minds',
      root: 'skills/automation',
    });
  });

  it('rejects a skill whose SKILL.md frontmatter is missing a version', async () => {
    seedBlob(client, 'plugins/genesis-minds/skills/automation/SKILL.md', 'skill-sha', [
      '---',
      'name: automation',
      '---',
      '# Automation',
    ].join('\n'));

    const materializer = new MarketplaceSkillMaterializer(client);

    await expect(materializer.materialize(SKILL)).rejects.toThrow('missing required frontmatter');
  });

  it('rejects a skill whose SKILL.md frontmatter name does not match the catalog id', async () => {
    seedBlob(client, 'plugins/genesis-minds/skills/automation/SKILL.md', 'skill-sha', [
      '---',
      'name: wrong',
      'version: 2.2.0',
      '---',
      '# Automation',
    ].join('\n'));

    const materializer = new MarketplaceSkillMaterializer(client);

    await expect(materializer.materialize(SKILL)).rejects.toThrow('frontmatter name');
  });
});

function seedBlob(client: FakeRegistryClient, path: string, sha: string, content: string): void {
  client.tree.push({ path, type: 'blob', sha });
  client.blobs.set(sha, Buffer.from(content));
}

function managedSha256(filePath: string, content: Buffer): string {
  return createHash('sha256')
    .update(filePath)
    .update('\0')
    .update(String(content.byteLength))
    .update('\0')
    .update(content)
    .update('\0')
    .digest('hex');
}
