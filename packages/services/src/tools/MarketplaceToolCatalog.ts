import { GitHubRegistryClient, type TreeEntry } from '../genesis/GitHubRegistryClient';
import type { MarketplaceToolEntry } from '@chamber/shared/types';
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

  const install = entry.install;
  if (!isRecord(install) || install.type !== 'npm-global'
    || typeof install.package !== 'string' || typeof install.version !== 'string') {
    throw new Error(`${pluginPath} tools[${index}].install must be { type: 'npm-global', package, version }`);
  }

  const help = optionalString(entry, 'help');
  const agentInstructions = optionalString(entry, 'agentInstructions');
  const preflight = optionalStringArray(entry, 'preflight', pluginPath, index);

  return {
    id,
    displayName,
    description,
    install: { type: 'npm-global', package: install.package, version: install.version },
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
