import path from 'node:path';
import { GitHubRegistryClient, type TreeEntry } from './GitHubRegistryClient';
import type {
  GenesisMindTemplate,
  GenesisMindTemplateMarketplaceSource,
} from './templateTypes';

export const DEFAULT_GENESIS_MIND_TEMPLATE_SOURCE: GenesisMindTemplateMarketplaceSource = {
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

interface RegistryClient {
  fetchTree(owner: string, repo: string, branch: string): TreeEntry[];
  fetchJsonContent(owner: string, repo: string, filePath: string, ref: string): unknown;
}

interface PluginMindEntry {
  id: string;
  manifest: string;
}

interface MindManifest {
  id: string;
  displayName: string;
  description: string;
  role: string;
  voice: string;
  templateVersion: string;
  root: string;
  agent: string;
  requiredFiles: string[];
}

export class GenesisMindTemplateCatalog {
  constructor(
    private readonly registryClient: RegistryClient = new GitHubRegistryClient(),
    private readonly source: GenesisMindTemplateMarketplaceSource = DEFAULT_GENESIS_MIND_TEMPLATE_SOURCE,
  ) {}

  listTemplates(): GenesisMindTemplate[] {
    const tree = this.registryClient.fetchTree(this.source.owner, this.source.repo, this.source.ref);
    const blobPaths = new Set(tree.filter((entry) => entry.type === 'blob').map((entry) => entry.path));

    this.requireBlob(blobPaths, 'marketplace-config.json', 'Marketplace config not found');
    const pluginPath = `plugins/${this.source.plugin}/plugin.json`;
    this.requireBlob(blobPaths, pluginPath, `Plugin manifest not found: ${pluginPath}`);

    const plugin = this.readRecord(pluginPath);
    const entries = this.readMindEntries(plugin, pluginPath);

    return entries.map((entry) => this.readTemplate(entry, blobPaths));
  }

  private readTemplate(entry: PluginMindEntry, blobPaths: Set<string>): GenesisMindTemplate {
    const manifestPath = this.safeJoin(`plugins/${this.source.plugin}`, entry.manifest, `Plugin mind ${entry.id} has unsafe manifest path`);
    this.requireBlob(blobPaths, manifestPath, `Template manifest not found: ${manifestPath}`);

    const manifest = this.readMindManifest(this.readRecord(manifestPath), manifestPath);
    const manifestDir = path.posix.dirname(manifestPath);
    const rootPath = this.safeJoin(manifestDir, manifest.root, `Template ${manifest.id} has unsafe root path: ${manifest.root}`);

    for (const file of manifest.requiredFiles) {
      if (!isSafeRelativePath(file)) {
        throw new Error(`Template ${manifest.id} has unsafe required file path: ${file}`);
      }
      const templateFilePath = path.posix.join(rootPath, file);
      this.requireBlob(blobPaths, templateFilePath, `Template ${manifest.id} is missing required file: ${file}`);
    }

    return {
      id: manifest.id,
      displayName: manifest.displayName,
      description: manifest.description,
      role: manifest.role,
      voice: manifest.voice,
      templateVersion: manifest.templateVersion,
      agent: manifest.agent,
      requiredFiles: manifest.requiredFiles,
      source: {
        owner: this.source.owner,
        repo: this.source.repo,
        ref: this.source.ref,
        plugin: this.source.plugin,
        manifestPath,
        rootPath,
        marketplaceId: this.source.id ?? marketplaceId(this.source),
        marketplaceLabel: this.source.label ?? `${this.source.owner}/${this.source.repo}`,
        marketplaceUrl: this.source.url ?? `https://github.com/${this.source.owner}/${this.source.repo}`,
      },
    };
  }

  private readRecord(filePath: string): Record<string, unknown> {
    const content = this.registryClient.fetchJsonContent(this.source.owner, this.source.repo, filePath, this.source.ref);
    if (!isRecord(content)) {
      throw new Error(`Expected ${filePath} to contain a JSON object`);
    }
    return content;
  }

  private readMindEntries(plugin: Record<string, unknown>, pluginPath: string): PluginMindEntry[] {
    const minds = plugin.minds;
    if (!Array.isArray(minds)) {
      throw new Error(`Plugin manifest ${pluginPath} must define a minds array`);
    }

    return minds.map((entry, index) => {
      if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.manifest !== 'string') {
        throw new Error(`Plugin manifest ${pluginPath} has invalid minds entry at index ${index}`);
      }
      return { id: entry.id, manifest: entry.manifest };
    });
  }

  private readMindManifest(manifest: Record<string, unknown>, manifestPath: string): MindManifest {
    const required = ['id', 'displayName', 'description', 'role', 'voice', 'templateVersion', 'root', 'agent'] as const;
    for (const key of required) {
      if (typeof manifest[key] !== 'string') {
        throw new Error(`Template manifest ${manifestPath} must define string field: ${key}`);
      }
    }
    if (!Array.isArray(manifest.requiredFiles) || manifest.requiredFiles.some((file) => typeof file !== 'string')) {
      throw new Error(`Template manifest ${manifestPath} must define requiredFiles as a string array`);
    }

    return {
      id: stringField(manifest, 'id'),
      displayName: stringField(manifest, 'displayName'),
      description: stringField(manifest, 'description'),
      role: stringField(manifest, 'role'),
      voice: stringField(manifest, 'voice'),
      templateVersion: stringField(manifest, 'templateVersion'),
      root: stringField(manifest, 'root'),
      agent: stringField(manifest, 'agent'),
      requiredFiles: manifest.requiredFiles,
    };
  }

  private requireBlob(blobPaths: Set<string>, filePath: string, message: string): void {
    if (!blobPaths.has(filePath)) {
      throw new Error(message);
    }
  }

  private safeJoin(base: string, relativePath: string, message: string): string {
    if (!isSafeRelativePath(relativePath)) {
      throw new Error(message);
    }
    return path.posix.normalize(path.posix.join(base, relativePath));
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string') {
    throw new Error(`Expected string field: ${key}`);
  }
  return value;
}

function isSafeRelativePath(value: string): boolean {
  if (!value || path.posix.isAbsolute(value)) return false;
  const normalized = path.posix.normalize(value);
  return normalized === '.' || (!normalized.startsWith('..') && !normalized.includes('/../'));
}

function marketplaceId(source: GenesisMindTemplateMarketplaceSource): string {
  return `github:${source.owner}/${source.repo}`;
}
