import { GitHubRegistryClient, type TreeEntry } from '../genesis/GitHubRegistryClient';
import type { GitHubReleaseAssetSelector, MarketplaceToolEntry, MarketplaceToolInstall } from '@chamber/shared/types';
import type { ToolMarketplaceSource } from './toolTypes';

interface RegistryClient {
  fetchTree(owner: string, repo: string, branch: string): Promise<TreeEntry[]>;
  fetchJsonContent(owner: string, repo: string, filePath: string, ref: string): Promise<unknown>;
}

type SourceProvider = ToolMarketplaceSource[] | (() => ToolMarketplaceSource[]);

export interface MarketplaceToolCatalogResult {
  tools: MarketplaceToolEntry[];
  errors: Array<{ marketplaceId: string; message: string }>;
}

/**
 * Reads `tools[]` from each enrolled marketplace's plugin.json.
 * Tools are an additive section alongside `minds[]`; absence is not an error.
 */
export class MarketplaceToolCatalog {
  constructor(
    private readonly registryClient: RegistryClient = new GitHubRegistryClient(),
    private readonly sourceProvider: SourceProvider = [],
  ) {}

  async listTools(): Promise<MarketplaceToolCatalogResult> {
    const tools: MarketplaceToolEntry[] = [];
    const errors: MarketplaceToolCatalogResult['errors'] = [];

    for (const source of this.getSources()) {
      if (source.enabled === false) continue;
      try {
        const sourceTools = await this.readSource(source);
        tools.push(...sourceTools);
      } catch (error) {
        errors.push({
          marketplaceId: source.id ?? `github:${source.owner}/${source.repo}`,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { tools, errors };
  }

  private async readSource(source: ToolMarketplaceSource): Promise<MarketplaceToolEntry[]> {
    const pluginPath = `plugins/${source.plugin}/plugin.json`;
    const plugin = await this.registryClient.fetchJsonContent(source.owner, source.repo, pluginPath, source.ref);
    if (!isRecord(plugin)) {
      throw new Error(`Plugin manifest ${pluginPath} is not a JSON object`);
    }
    const rawTools = plugin.tools;
    if (rawTools === undefined) return [];
    if (!Array.isArray(rawTools)) {
      throw new Error(`Plugin manifest ${pluginPath} has a non-array tools field`);
    }
    return rawTools.map((entry, index) => parseToolEntry(entry, index, pluginPath, source));
  }

  private getSources(): ToolMarketplaceSource[] {
    return typeof this.sourceProvider === 'function' ? this.sourceProvider() : this.sourceProvider;
  }
}

function parseToolEntry(
  entry: unknown,
  index: number,
  pluginPath: string,
  source: ToolMarketplaceSource,
): MarketplaceToolEntry {
  if (!isRecord(entry)) {
    throw new Error(`${pluginPath} tools[${index}] is not an object`);
  }
  const id = stringField(entry, 'id', pluginPath, index);
  const displayName = stringField(entry, 'displayName', pluginPath, index);
  const description = stringField(entry, 'description', pluginPath, index);
  const bin = stringField(entry, 'bin', pluginPath, index);

  const install = parseInstall(entry.install, pluginPath, index);

  const help = optionalString(entry, 'help');
  const agentInstructions = optionalString(entry, 'agentInstructions');
  const preflight = optionalStringArray(entry, 'preflight', pluginPath, index);

  return {
    id,
    displayName,
    description,
    install,
    bin,
    ...(help ? { help } : {}),
    ...(preflight ? { preflight } : {}),
    ...(agentInstructions ? { agentInstructions } : {}),
    source: {
      owner: source.owner,
      repo: source.repo,
      ref: source.ref,
      plugin: source.plugin,
      marketplaceId: source.id ?? `github:${source.owner}/${source.repo}`,
      marketplaceLabel: source.label ?? `${source.owner}/${source.repo}`,
      marketplaceUrl: source.url ?? `https://github.com/${source.owner}/${source.repo}`,
    },
  };
}

function parseInstall(value: unknown, pluginPath: string, index: number): MarketplaceToolInstall {
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new Error(`${pluginPath} tools[${index}].install must be a tool install object`);
  }
  if (value.type === 'npm-global') {
    if (typeof value.package !== 'string' || value.package.length === 0
      || typeof value.version !== 'string' || value.version.length === 0) {
      throw new Error(`${pluginPath} tools[${index}].install must be { type: 'npm-global', package, version }`);
    }
    return { type: 'npm-global', package: value.package, version: value.version };
  }
  if (value.type === 'github-release-asset') {
    return parseGitHubReleaseAssetInstall(value, pluginPath, index);
  }
  throw new Error(`${pluginPath} tools[${index}].install.type is not supported: ${value.type}`);
}

function parseGitHubReleaseAssetInstall(
  install: Record<string, unknown>,
  pluginPath: string,
  index: number,
): MarketplaceToolInstall {
  const installPrefix = `${pluginPath} tools[${index}].install`;
  const owner = requiredString(install, 'owner', installPrefix);
  const repo = requiredString(install, 'repo', installPrefix);
  const tag = requiredString(install, 'tag', installPrefix);
  const assets = install.assets;
  if (!Array.isArray(assets) || assets.length === 0) {
    throw new Error(`${pluginPath} tools[${index}].install.assets must be a non-empty array`);
  }
  return {
    type: 'github-release-asset',
    owner,
    repo,
    tag,
    assets: assets.map((asset, assetIndex) => parseGitHubReleaseAsset(asset, pluginPath, index, assetIndex)),
  };
}

function parseGitHubReleaseAsset(
  value: unknown,
  pluginPath: string,
  toolIndex: number,
  assetIndex: number,
): GitHubReleaseAssetSelector {
  if (!isRecord(value)) {
    throw new Error(`${pluginPath} tools[${toolIndex}].install.assets[${assetIndex}] is not an object`);
  }
  const prefix = `${pluginPath} tools[${toolIndex}].install.assets[${assetIndex}]`;
  const platform = requiredString(value, 'platform', prefix);
  const arch = requiredString(value, 'arch', prefix);
  const name = requiredString(value, 'name', prefix);
  const sha256 = requiredString(value, 'sha256', prefix);
  if (!/^[a-fA-F0-9]{64}$/.test(sha256)) {
    throw new Error(`${prefix}.sha256 must be a 64-character hex string`);
  }
  const archive = optionalArchive(value, prefix);
  const binPath = optionalString(value, 'binPath');
  return {
    platform,
    arch,
    name,
    sha256: sha256.toLowerCase(),
    ...(archive ? { archive } : {}),
    ...(binPath ? { binPath } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string, pluginPath: string, index: number): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${pluginPath} tools[${index}].${key} must be a non-empty string`);
  }
  return value;
}

function requiredString(record: Record<string, unknown>, key: string, prefix: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${prefix}.${key} must be a non-empty string`);
  }
  return value;
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function optionalStringArray(
  record: Record<string, unknown>,
  key: string,
  pluginPath: string,
  index: number,
): string[] | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${pluginPath} tools[${index}].${key} must be a string array`);
  }
  return value as string[];
}

function optionalArchive(record: Record<string, unknown>, prefix: string): 'zip' | 'tar.gz' | undefined {
  const value = record.archive;
  if (value === undefined) return undefined;
  if (value !== 'zip' && value !== 'tar.gz') {
    throw new Error(`${prefix}.archive must be "zip" or "tar.gz"`);
  }
  return value;
}
