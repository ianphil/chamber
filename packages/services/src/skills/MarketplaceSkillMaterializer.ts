import { createHash } from 'node:crypto';
import type { GitHubRegistryClient, TreeEntry } from '../genesis';
import type { ManagedSkillAsset, MarketplaceSkillEntry } from './skillTypes';

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---/;

interface SkillFrontmatter {
  name?: string;
  version?: string;
}

export class MarketplaceSkillMaterializer {
  constructor(private readonly registryClient: Pick<GitHubRegistryClient, 'fetchTree' | 'fetchBlob'>) {}

  async materialize(skill: MarketplaceSkillEntry): Promise<ManagedSkillAsset> {
    const { owner, repo, ref, plugin } = skill.source;
    const tree = await this.registryClient.fetchTree(owner, repo, ref);
    const rootPrefix = `plugins/${plugin}/${skill.root}/`;
    const entries = tree
      .filter((entry): entry is TreeEntry & { sha: string } =>
        entry.type === 'blob' &&
        typeof entry.sha === 'string' &&
        entry.path.startsWith(rootPrefix))
      .map((entry) => ({
        entry,
        relativePath: entry.path.slice(rootPrefix.length),
      }))
      .filter(({ relativePath }) => isSafeRelativePath(relativePath))
      .sort((left, right) => compareText(left.relativePath, right.relativePath));

    const files = await Promise.all(entries.map(async ({ entry, relativePath }) => {
      const content = await this.registryClient.fetchBlob(owner, repo, entry.sha);
      return {
        path: relativePath,
        content,
        sha256: computeManagedFileHash(relativePath, content),
      };
    }));

    const skillMarkdown = files.find((file) => file.path === 'SKILL.md')?.content.toString('utf8');
    if (!skillMarkdown) {
      throw new Error(`Marketplace skill ${skill.id} is missing SKILL.md`);
    }

    const frontmatter = parseSkillFrontmatter(skillMarkdown);
    if (!frontmatter.name || !frontmatter.version) {
      throw new Error(`Marketplace skill ${skill.id} SKILL.md missing required frontmatter name/version`);
    }
    if (frontmatter.name !== skill.id) {
      throw new Error(`Marketplace skill ${skill.id} frontmatter name must match catalog id`);
    }

    return {
      manifest: {
        name: frontmatter.name,
        version: frontmatter.version,
        capabilities: skill.capabilities,
      },
      files,
      source: {
        type: 'marketplace',
        marketplaceId: skill.source.marketplaceId,
        marketplaceLabel: skill.source.marketplaceLabel,
        marketplaceUrl: skill.source.marketplaceUrl,
        owner,
        repo,
        ref,
        plugin,
        root: skill.root,
      },
    };
  }
}

export function computeManagedFileHash(filePath: string, content: Buffer): string {
  return createHash('sha256')
    .update(filePath)
    .update('\0')
    .update(String(content.byteLength))
    .update('\0')
    .update(content)
    .update('\0')
    .digest('hex');
}

function parseSkillFrontmatter(markdown: string): SkillFrontmatter {
  const match = FRONTMATTER_PATTERN.exec(markdown);
  if (!match) return {};

  const frontmatter: SkillFrontmatter = {};
  for (const rawLine of match[1].split(/\r?\n/)) {
    const separatorIndex = rawLine.indexOf(':');
    if (separatorIndex < 0) continue;
    const key = rawLine.slice(0, separatorIndex).trim();
    const value = rawLine.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key === 'name') frontmatter.name = value;
    if (key === 'version') frontmatter.version = value;
  }
  return frontmatter;
}

function isSafeRelativePath(path: string): boolean {
  return path.length > 0 &&
    !path.startsWith('/') &&
    !path.startsWith('\\') &&
    !path.includes('\\') &&
    !path.split('/').includes('..');
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
