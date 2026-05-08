import type { AppConfig, InstalledTool, MarketplaceToolEntry, ToolActionResult, ToolCatalogEntry } from '@chamber/shared/types';
import { Logger } from '../logger';
import { MarketplaceToolCatalog } from './MarketplaceToolCatalog';
import { ToolInstaller } from './ToolInstaller';

const log = Logger.create('ToolsService');

interface ConfigStore {
  load(): AppConfig;
  save(config: AppConfig): void;
}

/**
 * Orchestrates the marketplace-tool lifecycle: list (catalog ∪ installed),
 * install (npm i -g + persist), uninstall (npm uninstall -g + persist), and
 * startup reconciliation (install everything new since last run).
 */
export class ToolsService {
  constructor(
    private readonly catalog: MarketplaceToolCatalog,
    private readonly installer: ToolInstaller,
    private readonly configStore: ConfigStore,
  ) {}

  async list(): Promise<ToolCatalogEntry[]> {
    const installed = this.getInstalled();
    const installedById = new Map(installed.map((tool) => [tool.id, tool]));
    const result = await this.catalog.listTools();
    const catalogEntries: ToolCatalogEntry[] = result.tools.map((tool) => {
      const persisted = installedById.get(tool.id);
      return {
        ...tool,
        status: persisted ? 'installed' : 'available',
        ...(persisted ? { installedVersion: persisted.version } : {}),
      };
    });
    return catalogEntries;
  }

  async install(toolId: string, marketplaceId?: string): Promise<ToolActionResult> {
    const result = await this.catalog.listTools();
    const tool = result.tools.find((entry) =>
      entry.id === toolId
      && (!marketplaceId || entry.source.marketplaceId === marketplaceId),
    );
    if (!tool) {
      return { success: false, error: `Tool not found in marketplace: ${toolId}` };
    }
    return this.installEntry(tool);
  }

  async uninstall(toolId: string): Promise<{ success: boolean; error?: string }> {
    const installed = this.getInstalled();
    const tool = installed.find((entry) => entry.id === toolId);
    if (!tool) {
      return { success: false, error: `Tool not installed: ${toolId}` };
    }
    try {
      await this.installer.uninstall(tool);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
    this.persist(installed.filter((entry) => entry.id !== toolId));
    return { success: true };
  }

  /**
   * Install any marketplace tools that are not already in installedTools[].
   * Errors on individual tools are logged and skipped — other tools still install.
   */
  async reconcile(): Promise<{ installed: InstalledTool[]; errors: Array<{ toolId: string; message: string }> }> {
    const result = await this.catalog.listTools();
    const installed = this.getInstalled();
    const installedIds = new Set(installed.map((tool) => tool.id));
    const newTools = result.tools.filter((tool) => !installedIds.has(tool.id));

    const newlyInstalled: InstalledTool[] = [];
    const errors: Array<{ toolId: string; message: string }> = [];

    for (const tool of newTools) {
      const outcome = await this.installEntry(tool);
      if (outcome.success) {
        newlyInstalled.push(outcome.tool);
      } else {
        log.warn(`Reconcile failed for tool ${tool.id}: ${outcome.error}`);
        errors.push({ toolId: tool.id, message: outcome.error });
      }
    }

    return { installed: newlyInstalled, errors };
  }

  private async installEntry(tool: MarketplaceToolEntry): Promise<ToolActionResult> {
    try {
      const installed = await this.installer.install(tool);
      const current = this.getInstalled();
      const next = [...current.filter((entry) => entry.id !== installed.id), installed];
      this.persist(next);
      return { success: true, tool: installed };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private getInstalled(): InstalledTool[] {
    return this.configStore.load().installedTools ?? [];
  }

  private persist(tools: InstalledTool[]): void {
    const config = this.configStore.load();
    this.configStore.save({ ...config, installedTools: tools });
  }
}
