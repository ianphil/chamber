import path from 'node:path';
import { DEFAULT_GENESIS_MIND_TEMPLATE_SOURCE, GitHubRegistryClient, type TreeEntry } from '../genesis';
import type { MarketplaceSkillEntry, SkillMarketplaceSource } from './skillTypes';

interface RegistryClient {
  fetchTree(owner: string, repo: string, branch: string): Promise<TreeEntry[]>;
  fetchJsonContent(owner: string, repo: string, filePath: string, ref: string): Promise<unknown>;
}

type SourceProvider = SkillMarketplaceSource[] | (() => SkillMarketplaceSource[]);

export interface MarketplaceSkillCatalogResult {
  skills: MarketplaceSkillEntry[];
  errors: Array<{ marketplaceId: string; message: string }>;
}

const RESERVED_CORE_SKILL_IDS = new Set(['lens', 'automation', 'ttasks']);
const DEFAULT_CORE_SKILL_MARKETPLACE_ID = marketplaceId(DEFAULT_GENESIS_MIND_TEMPLATE_SOURCE);

export class MarketplaceSkillCatalog {
  constructor(
    private readonly registryClient: RegistryClient = new GitHubRegistryClient(),
    private readonly sourceProvider: SourceProvider = [DEFAULT_GENESIS_MIND_TEMPLATE_SOURCE],
  ) {}

  async listSkills(): Promise<MarketplaceSkillCatalogResult> {
    const skills: MarketplaceSkillEntry[] = [];
    const errors: MarketplaceSkillCatalogResult['errors'] = [];

    for (const source of this.getSources()) {
      if (source.enabled === false) continue;
      try {
        skills.push(...await this.readSource(source));
      } catch (error) {
        errors.push({
          marketplaceId: marketplaceId(source),
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { skills, errors };
  }

  private async readSource(source: SkillMarketplaceSource): Promise<MarketplaceSkillEntry[]> {
    const tree = await this.registryClient.fetchTree(source.owner, source.repo, source.ref);
    const blobPaths = new Set(tree.filter((entry) => entry.type === 'blob').map((entry) => entry.path));
    const pluginPath = `plugins/${source.plugin}/plugin.json`;
    const plugin = await this.registryClient.fetchJsonContent(source.owner, source.repo, pluginPath, source.ref);
    if (!isRecord(plugin)) {
      throw new Error(`Plugin manifest ${pluginPath} is not a JSON object`);
    }
    if (plugin.skills === undefined) return [];
    if (!Array.isArray(plugin.skills)) {
      throw new Error(`Plugin manifest ${pluginPath} has a non-array skills field`);
    }
    return plugin.skills.map((entry, index) => parseSkillEntry(entry, index, pluginPath, source, blobPaths));
  }

  private getSources(): SkillMarketplaceSource[] {
    return typeof this.sourceProvider === 'function' ? this.sourceProvider() : this.sourceProvider;
  }
}

function parseSkillEntry(
  entry: unknown,
  index: number,
  pluginPath: string,
  source: SkillMarketplaceSource,
  blobPaths: Set<string>,
): MarketplaceSkillEntry {
  if (!isRecord(entry)) {
    throw new Error(`${pluginPath} skills[${index}] is not an object`);
  }
  const id = stringField(entry, 'id', pluginPath, index);
  const reserved = RESERVED_CORE_SKILL_IDS.has(id);
  if (reserved && marketplaceId(source) !== DEFAULT_CORE_SKILL_MARKETPLACE_ID) {
    throw new Error(`${pluginPath} skills[${index}] declares reserved core skill "${id}" from non-default marketplace`);
  }

  const root = stringField(entry, 'root', pluginPath, index);
  if (!isSafeRelativePath(root)) {
    throw new Error(`${pluginPath} skills[${index}].root must be a safe relative path`);
  }
  const requiredFiles = stringArrayField(entry, 'requiredFiles', pluginPath, index);
  const rootPath = safeJoin(`plugins/${source.plugin}`, root);
  for (const file of requiredFiles) {
    if (!isSafeRelativePath(file)) {
      throw new Error(`${pluginPath} skills[${index}].requiredFiles must contain only safe relative paths`);
    }
    if (!blobPaths.has(path.posix.join(rootPath, file))) {
      throw new Error(`${pluginPath} skills[${index}] is missing required file: ${file}`);
    }
  }

  return {
    id,
    displayName: stringField(entry, 'displayName', pluginPath, index),
    description: stringField(entry, 'description', pluginPath, index),
    root,
    requiredFiles,
    capabilities: stringArrayField(entry, 'capabilities', pluginPath, index),
    reserved,
    source: {
      owner: source.owner,
      repo: source.repo,
      ref: source.ref,
      plugin: source.plugin,
      marketplaceId: marketplaceId(source),
      marketplaceLabel: source.label ?? `${source.owner}/${source.repo}`,
      marketplaceUrl: source.url ?? `https://github.com/${source.owner}/${source.repo}`,
      isDefault: source.isDefault === true,
    },
  };
}

function safeJoin(base: string, relativePath: string): string {
  return path.posix.normalize(path.posix.join(base, relativePath));
}

function marketplaceId(source: Pick<SkillMarketplaceSource, 'id' | 'owner' | 'repo'>): string {
  return source.id ?? `github:${source.owner}/${source.repo}`;
}

function stringField(record: Record<string, unknown>, key: string, pluginPath: string, index: number): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${pluginPath} skills[${index}].${key} must be a non-empty string`);
  }
  return value;
}

function stringArrayField(record: Record<string, unknown>, key: string, pluginPath: string, index: number): string[] {
  const value = record[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${pluginPath} skills[${index}].${key} must be a string array`);
  }
  return value as string[];
}

function isSafeRelativePath(value: string): boolean {
  if (!value || path.posix.isAbsolute(value) || value.includes('\\')) return false;
  const normalized = path.posix.normalize(value);
  return normalized !== '..' && !normalized.startsWith('../') && !normalized.includes('/../');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
