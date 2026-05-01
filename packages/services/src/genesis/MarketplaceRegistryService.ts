import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { DEFAULT_GENESIS_MIND_TEMPLATE_SOURCE } from './GenesisMindTemplateCatalog';
import type { TreeEntry } from './GitHubRegistryClient';
import type { AppConfig, MarketplaceRegistry, MarketplaceRegistryActionResult } from '@chamber/shared/types';

const execFileAsync = promisify(execFile);
const GITHUB_OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const GITHUB_REPO_PATTERN = /^[A-Za-z0-9._-]+$/;
const MANIFEST_STRING_FIELDS = ['id', 'displayName', 'description', 'role', 'voice', 'templateVersion', 'root', 'agent'] as const;

interface ConfigStore {
  load(): AppConfig;
  save(config: AppConfig): void;
}

interface RegistryClient {
  fetchTree(owner: string, repo: string, branch: string): Promise<TreeEntry[]>;
  fetchJsonContent(owner: string, repo: string, filePath: string, ref: string): Promise<unknown>;
}

interface GitHubAuthInspector {
  getActiveLogin(): Promise<string | null>;
}

class MarketplaceManifestError extends Error {}

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

class AsyncGitHubAuthInspector implements GitHubAuthInspector {
  async getActiveLogin(): Promise<string | null> {
    try {
      const { stdout, stderr } = await execFileAsync(
        'gh',
        ['auth', 'status', '--hostname', 'github.com', '--active'],
        { encoding: 'utf8', timeout: 10_000 },
      );
      return parseActiveLogin(`${stdout}\n${stderr}`);
    } catch (error) {
      return parseActiveLogin(commandOutput(error));
    }
  }
}

export class MarketplaceRegistryService {
  constructor(
    private readonly configStore: ConfigStore,
    private readonly registryClient: RegistryClient = new AsyncGitHubRegistryClient(),
    private readonly authInspector: GitHubAuthInspector = new AsyncGitHubAuthInspector(),
  ) {}

  listGenesisRegistries(): MarketplaceRegistry[] {
    return this.configStore.load().marketplaceRegistries ?? [DEFAULT_GENESIS_MIND_TEMPLATE_SOURCE as MarketplaceRegistry];
  }

  async addGenesisRegistry(rawUrl: unknown): Promise<MarketplaceRegistryActionResult> {
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
    } catch (error) {
      return {
        success: false,
        error: await marketplaceValidationMessage(registry, error, this.authInspector),
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

  async refreshGenesisRegistry(id: unknown): Promise<MarketplaceRegistryActionResult> {
    if (typeof id !== 'string') {
      return { success: false, error: 'Marketplace id must be a string.' };
    }
    const registry = this.findRegistry(id);
    if (!registry) {
      return { success: false, error: 'Marketplace not found.' };
    }

    try {
      await validateGenesisMarketplace(this.registryClient, registry);
      return { success: true, registry };
    } catch (error) {
      return {
        success: false,
        error: await marketplaceValidationMessage(registry, error, this.authInspector),
      };
    }
  }

  setGenesisRegistryEnabled(id: unknown, enabled: unknown): MarketplaceRegistryActionResult {
    if (typeof id !== 'string') {
      return { success: false, error: 'Marketplace id must be a string.' };
    }
    if (typeof enabled !== 'boolean') {
      return { success: false, error: 'Marketplace enabled state must be a boolean.' };
    }
    const config = this.configStore.load();
    const registries = config.marketplaceRegistries ?? [DEFAULT_GENESIS_MIND_TEMPLATE_SOURCE as MarketplaceRegistry];
    const index = registries.findIndex((registry) => registry.id === id);
    if (index < 0) {
      return { success: false, error: 'Marketplace not found.' };
    }

    const nextRegistries = [...registries];
    nextRegistries[index] = { ...nextRegistries[index], enabled };
    this.configStore.save({ ...config, marketplaceRegistries: nextRegistries });
    return { success: true, registry: nextRegistries[index] };
  }

  removeGenesisRegistry(id: unknown): MarketplaceRegistryActionResult {
    if (typeof id !== 'string') {
      return { success: false, error: 'Marketplace id must be a string.' };
    }
    const config = this.configStore.load();
    const registries = config.marketplaceRegistries ?? [DEFAULT_GENESIS_MIND_TEMPLATE_SOURCE as MarketplaceRegistry];
    const registry = registries.find((item) => item.id === id);
    if (!registry) {
      return { success: false, error: 'Marketplace not found.' };
    }
    if (registry.isDefault) {
      return { success: false, error: 'The default marketplace cannot be removed.' };
    }

    this.configStore.save({
      ...config,
      marketplaceRegistries: registries.filter((item) => item.id !== id),
    });
    return { success: true, registry };
  }

  private findRegistry(id: string): MarketplaceRegistry | undefined {
    return this.listGenesisRegistries().find((registry) => registry.id === id);
  }
}

function parseGitHubMarketplaceUrl(rawUrl: unknown): MarketplaceRegistry {
  if (typeof rawUrl !== 'string') {
    throw new Error('Enter a GitHub marketplace repository URL.');
  }
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
    throw new MarketplaceManifestError(`Plugin manifest ${pluginPath} must define a minds array`);
  }

  for (const entry of plugin.minds) {
    if (!isRecord(entry) || typeof entry.manifest !== 'string') {
      throw new MarketplaceManifestError(`Plugin manifest ${pluginPath} has an invalid minds entry`);
    }
    const manifestPath = `plugins/${registry.plugin}/${entry.manifest}`;
    requireBlob(blobPaths, manifestPath);
    const manifest = await registryClient.fetchJsonContent(registry.owner, registry.repo, manifestPath, registry.ref);
    validateMindManifest(manifest, manifestPath, blobPaths);
  }
}

function requireBlob(blobPaths: Set<string>, filePath: string): void {
  if (!blobPaths.has(filePath)) {
    throw new MarketplaceManifestError(`Marketplace missing required file: ${filePath}`);
  }
}

function validateMindManifest(
  manifest: unknown,
  manifestPath: string,
  blobPaths: Set<string>,
): void {
  if (!isRecord(manifest)) {
    throw new MarketplaceManifestError(`Expected ${manifestPath} to contain a JSON object`);
  }
  for (const field of MANIFEST_STRING_FIELDS) {
    if (typeof manifest[field] !== 'string') {
      throw new MarketplaceManifestError(`Template manifest ${manifestPath} must define string field: ${field}`);
    }
  }
  if (!Array.isArray(manifest.requiredFiles) || manifest.requiredFiles.some((file) => typeof file !== 'string')) {
    throw new MarketplaceManifestError(`Template manifest ${manifestPath} must define requiredFiles as a string array`);
  }

  const manifestId = manifest.id as string;
  const root = manifest.root as string;
  const manifestDir = path.posix.dirname(manifestPath);
  const rootPath = safeJoin(manifestDir, root, `Template ${manifestId} has unsafe root path: ${root}`);
  for (const file of manifest.requiredFiles) {
    if (!isSafeRelativePath(file)) {
      throw new MarketplaceManifestError(`Template ${manifestId} has unsafe required file path: ${file}`);
    }
    requireBlob(blobPaths, path.posix.join(rootPath, file));
  }
}

function safeJoin(base: string, relativePath: string, message: string): string {
  if (!isSafeRelativePath(relativePath)) {
    throw new MarketplaceManifestError(message);
  }
  return path.posix.normalize(path.posix.join(base, relativePath));
}

function isSafeRelativePath(value: string): boolean {
  if (!value || path.posix.isAbsolute(value)) return false;
  const normalized = path.posix.normalize(value);
  return normalized === '.' || (!normalized.startsWith('..') && !normalized.includes('/../'));
}

async function marketplaceValidationMessage(
  registry: MarketplaceRegistry,
  error: unknown,
  authInspector: GitHubAuthInspector,
): Promise<string> {
  if (error instanceof MarketplaceManifestError) {
    return `Marketplace ${registry.label} is invalid: ${error.message}`;
  }
  const activeLogin = await authInspector.getActiveLogin();
  const activeAccount = activeLogin ? ` with the active GitHub CLI account "${activeLogin}"` : '';
  return `Unable to access marketplace ${registry.label}${activeAccount}. Chamber uses the GitHub CLI to read marketplace repositories. Run "gh auth status --hostname github.com" to confirm the active account, then run "gh auth switch --user <account-with-access>" or "gh auth login" before trying again.`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseActiveLogin(output: string): string | null {
  const match = output.match(/Logged in to github\.com account ([^\s]+) /);
  return match?.[1] ?? null;
}

function commandOutput(error: unknown): string {
  if (!isRecord(error)) return String(error);
  const stdout = typeof error.stdout === 'string' ? error.stdout : '';
  const stderr = typeof error.stderr === 'string' ? error.stderr : '';
  const message = error instanceof Error ? error.message : '';
  return `${stdout}\n${stderr}\n${message}`;
}
