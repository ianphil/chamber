import { GitHubRegistryClient, type TreeEntry } from './GitHubRegistryClient';
import { GenesisMindTemplateCatalog, DEFAULT_GENESIS_MIND_TEMPLATE_SOURCE } from './GenesisMindTemplateCatalog';
import type {
  GenesisMindTemplateMarketplaceResult,
  GenesisMindTemplateMarketplaceSource,
  GenesisMindTemplateMarketplaceStatus,
} from './templateTypes';

interface RegistryClient {
  fetchTree(owner: string, repo: string, branch: string): TreeEntry[];
  fetchJsonContent(owner: string, repo: string, filePath: string, ref: string): unknown;
}

type SourceProvider =
  | GenesisMindTemplateMarketplaceSource[]
  | (() => GenesisMindTemplateMarketplaceSource[]);

export class GenesisMindTemplateMarketplaceCatalog {
  constructor(
    private readonly registryClient: RegistryClient = new GitHubRegistryClient(),
    private readonly sourceProvider: SourceProvider = [DEFAULT_GENESIS_MIND_TEMPLATE_SOURCE],
  ) {}

  listTemplates(): GenesisMindTemplateMarketplaceResult {
    const templates: GenesisMindTemplateMarketplaceResult['templates'] = [];
    const sources: GenesisMindTemplateMarketplaceStatus[] = [];

    for (const source of this.getSources()) {
      const metadata = sourceMetadata(source);
      if (source.enabled === false) {
        sources.push({ ...metadata, status: 'disabled', templateCount: 0 });
        continue;
      }

      try {
        const sourceTemplates = new GenesisMindTemplateCatalog(this.registryClient, source).listTemplates();
        templates.push(...sourceTemplates);
        sources.push({ ...metadata, status: 'ok', templateCount: sourceTemplates.length });
      } catch {
        sources.push({
          ...metadata,
          status: 'error',
          templateCount: 0,
          message: `Unable to access marketplace ${metadata.label}. Check your GitHub sign-in or repository access.`,
        });
      }
    }

    return { templates, sources };
  }

  private getSources(): GenesisMindTemplateMarketplaceSource[] {
    return typeof this.sourceProvider === 'function'
      ? this.sourceProvider()
      : this.sourceProvider;
  }
}

function sourceMetadata(source: GenesisMindTemplateMarketplaceSource): Pick<GenesisMindTemplateMarketplaceStatus, 'id' | 'label' | 'url'> {
  return {
    id: source.id ?? `github:${source.owner}/${source.repo}`,
    label: source.label ?? `${source.owner}/${source.repo}`,
    url: source.url ?? `https://github.com/${source.owner}/${source.repo}`,
  };
}
