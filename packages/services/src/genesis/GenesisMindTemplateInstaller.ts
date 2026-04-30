import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { CopilotClientFactory } from '../sdk/CopilotClientFactory';
import { DEFAULT_GENESIS_MIND_TEMPLATE_SOURCE, GenesisMindTemplateCatalog } from './GenesisMindTemplateCatalog';
import { GenesisMindTemplateMarketplaceCatalog } from './GenesisMindTemplateMarketplaceCatalog';
import { GitHubRegistryClient, type TreeEntry } from './GitHubRegistryClient';
import { MindScaffold } from './MindScaffold';
import type { GenesisMindTemplate, GenesisMindTemplateMarketplaceSource } from './templateTypes';

const IDEA_FOLDERS = ['inbox', 'domains', 'expertise', 'initiatives', 'Archive'];
const WORKING_MEMORY_FILES = ['memory.md', 'rules.md', 'log.md'];

interface RegistryClient {
  fetchTree(owner: string, repo: string, branch: string): TreeEntry[];
  fetchJsonContent(owner: string, repo: string, filePath: string, ref: string): unknown;
  fetchBlob(owner: string, repo: string, sha: string): Buffer;
}

type ClientFactory = Pick<CopilotClientFactory, 'createClient' | 'destroyClient'>;
type SourceProvider =
  | GenesisMindTemplateMarketplaceSource
  | GenesisMindTemplateMarketplaceSource[]
  | (() => GenesisMindTemplateMarketplaceSource[]);

export interface GenesisMindTemplateInstallRequest {
  templateId: string;
  basePath: string;
}

export class GenesisMindTemplateInstaller {
  constructor(
    private readonly registryClient: RegistryClient = new GitHubRegistryClient(),
    public readonly clientFactory: ClientFactory = new CopilotClientFactory(),
    private readonly sourceProvider: SourceProvider = DEFAULT_GENESIS_MIND_TEMPLATE_SOURCE,
  ) {}

  async install(request: GenesisMindTemplateInstallRequest): Promise<string> {
    const template = this.listTemplates().find((item) => item.id === request.templateId);
    if (!template) {
      throw new Error(`Genesis mind template not found: ${request.templateId}`);
    }

    const mindPath = path.join(request.basePath, MindScaffold.slugify(template.displayName));
    this.createStructure(mindPath);
    this.copyTemplateFiles(template, mindPath);

    const validation = new MindScaffold().validate(mindPath);
    if (!validation.ok) {
      throw new Error(`Installed template ${template.id} is invalid: ${validation.missing.join(', ')}`);
    }

    this.initGit(mindPath);
    return mindPath;
  }

  private createStructure(mindPath: string): void {
    for (const folder of IDEA_FOLDERS) {
      fs.mkdirSync(path.join(mindPath, folder), { recursive: true });
    }
    fs.mkdirSync(path.join(mindPath, '.github', 'agents'), { recursive: true });
    fs.mkdirSync(path.join(mindPath, '.github', 'skills'), { recursive: true });
    fs.mkdirSync(path.join(mindPath, '.working-memory'), { recursive: true });

    for (const file of WORKING_MEMORY_FILES) {
      const filePath = path.join(mindPath, '.working-memory', file);
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, '');
      }
    }
  }

  private copyTemplateFiles(template: GenesisMindTemplate, mindPath: string): void {
    const tree = this.registryClient.fetchTree(template.source.owner, template.source.repo, template.source.ref);
    const templatePrefix = `${template.source.rootPath}/`;
    const entries = tree.filter((entry) => entry.type === 'blob' && entry.path.startsWith(templatePrefix));

    for (const entry of entries) {
      const relativePath = path.posix.relative(template.source.rootPath, entry.path);
      if (!isSafeRelativePath(relativePath)) {
        throw new Error(`Template ${template.id} has unsafe repository file path: ${entry.path}`);
      }

      const content = this.registryClient.fetchBlob(template.source.owner, template.source.repo, entry.sha);
      const localPath = path.join(mindPath, ...relativePath.split('/'));
      fs.mkdirSync(path.dirname(localPath), { recursive: true });
      fs.writeFileSync(localPath, content);
    }
  }

  private initGit(mindPath: string): void {
    execSync('git init', { cwd: mindPath, stdio: 'ignore' });
    execSync('git add -A', { cwd: mindPath, stdio: 'ignore' });
    execSync('git commit -m "Genesis template install"', { cwd: mindPath, stdio: 'ignore' });
  }

  private listTemplates(): GenesisMindTemplate[] {
    if (typeof this.sourceProvider === 'function' || Array.isArray(this.sourceProvider)) {
      return new GenesisMindTemplateMarketplaceCatalog(this.registryClient, this.sourceProvider).listTemplates().templates;
    }
    return new GenesisMindTemplateCatalog(this.registryClient, this.sourceProvider).listTemplates();
  }
}

function isSafeRelativePath(value: string): boolean {
  if (!value || path.posix.isAbsolute(value)) return false;
  const normalized = path.posix.normalize(value);
  return normalized !== '.' && !normalized.startsWith('..') && !normalized.includes('/../');
}
