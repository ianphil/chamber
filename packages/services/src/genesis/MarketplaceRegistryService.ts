import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DEFAULT_GENESIS_MIND_TEMPLATE_SOURCE } from './GenesisMindTemplateCatalog';
import type { TreeEntry } from './GitHubRegistryClient';
import type { AppConfig, MarketplaceRegistry, MarketplaceRegistryActionResult } from '@chamber/shared/types';

const execFileAsync = promisify(execFile);
const GITHUB_OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const GITHUB_REPO_PATTERN = /^[A-Za-z0-9._-]+$/;

interface ConfigStore {
  load(): AppConfig;
  save(config: AppConfig): void;
}

interface RegistryClient {
  fetchTree(owner: string, repo: string, branch: string): Promise<TreeEntry[]>;
  fetchJsonContent(owner: string, repo: string, filePath: string, ref: string): Promise<unknown>;
}

class AsyncGitHubRegistryClient implements RegistryClient {
  async fetchTree(owner: string, repo: string, branch: string): Promise<TreeEntry[]> {
    const { stdout } = await execFileAsync(
      'gh',
      ['api', `/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`],
      { encoding: 'utf8', timeout: 30_000 },
    );
    return (JSON.parse(stdout) as { tree: TreeEntry[] }).tree;
  }

  async fetchJsonContent(owner: string, repo: string, filePath: string, ref: string): Promise<unknown> {
    const { stdout } = await execFileAsync(
      'gh',
      ['api', `/repos/${owner}/${repo}/contents/${filePath}?ref=${ref}`],
      { encoding: 'utf8', timeout: 30_000 },
    );
    const content = JSON.parse(stdout) as { content: string };
    return JSON.parse(Buffer.from(content.content, 'base64').toString('utf8'));
  }
}

export class MarketplaceRegistryService {
  constructor(
    private readonly configStore: ConfigStore,
    private readonly registryClient: RegistryClient = new AsyncGitHubRegistryClient(),
  ) {}

  listGenesisRegistries(): MarketplaceRegistry[] {
    return this.configStore.load().marketplaceRegistries ?? [DEFAULT_GENESIS_MIND_TEMPLATE_SOURCE as MarketplaceRegistry];
  }

  async addGenesisRegistry(rawUrl: string): Promise<MarketplaceRegistryActionResult> {
    let registry: MarketplaceRegistry;
    try {
      registry = parseGitHubMarketplaceUrl(rawUrl);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    try {
      await validateGenesisMarketplace(this.registryClient, registry);
    } catch {
      return {
        success: false,
        error: `Unable to access marketplace ${registry.label}. Check your GitHub sign-in or repository access.`,
      };
    }

    const config = this.configStore.load();
    const registries = config.marketplaceRegistries ?? [DEFAULT_GENESIS_MIND_TEMPLATE_SOURCE as MarketplaceRegistry];
    const existingIndex = registries.findIndex((item) => item.id === registry.id);
    const nextRegistries = [...registries];
    if (existingIndex >= 0) {
      nextRegistries[existingIndex] = { ...nextRegistries[existingIndex], enabled: true };
      registry = nextRegistries[existingIndex];
    } else {
      nextRegistries.push(registry);
    }

    this.configStore.save({ ...config, marketplaceRegistries: nextRegistries });
    return { success: true, registry };
  }
}

function parseGitHubMarketplaceUrl(rawUrl: string): MarketplaceRegistry {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new Error('Enter a GitHub marketplace repository URL.');
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('Enter a valid GitHub repository URL.');
  }

  if (url.hostname !== 'github.com') {
    throw new Error('Marketplace URLs must point to github.com repositories.');
  }

  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length < 2) {
    throw new Error('Marketplace URLs must include an owner and repository.');
  }

  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/, '');
  if (!owner || !repo) {
    throw new Error('Marketplace URLs must include an owner and repository.');
  }
  if (!GITHUB_OWNER_PATTERN.test(owner) || !GITHUB_REPO_PATTERN.test(repo)) {
    throw new Error('Marketplace URLs must include a valid GitHub owner and repository name.');
  }

  return {
    id: `github:${owner}/${repo}`,
    label: `${owner}/${repo}`,
    url: `https://github.com/${owner}/${repo}`,
    owner,
    repo,
    ref: 'main',
    plugin: 'genesis-minds',
    enabled: true,
    isDefault: false,
  };
}

async function validateGenesisMarketplace(registryClient: RegistryClient, registry: MarketplaceRegistry): Promise<void> {
  const tree = await registryClient.fetchTree(registry.owner, registry.repo, registry.ref);
  const blobPaths = new Set(tree.filter((entry) => entry.type === 'blob').map((entry) => entry.path));

  requireBlob(blobPaths, 'marketplace-config.json');
  const pluginPath = `plugins/${registry.plugin}/plugin.json`;
  requireBlob(blobPaths, pluginPath);

  const plugin = await registryClient.fetchJsonContent(registry.owner, registry.repo, pluginPath, registry.ref);
  if (!isRecord(plugin) || !Array.isArray(plugin.minds)) {
    throw new Error(`Plugin manifest ${pluginPath} must define a minds array`);
  }

  for (const entry of plugin.minds) {
    if (!isRecord(entry) || typeof entry.manifest !== 'string') {
      throw new Error(`Plugin manifest ${pluginPath} has an invalid minds entry`);
    }
    const manifestPath = `plugins/${registry.plugin}/${entry.manifest}`;
    requireBlob(blobPaths, manifestPath);
  }
}

function requireBlob(blobPaths: Set<string>, filePath: string): void {
  if (!blobPaths.has(filePath)) {
    throw new Error(`Marketplace missing required file: ${filePath}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
