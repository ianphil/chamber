import { Logger } from '../logger';
import { getErrorMessage } from '@chamber/shared/getErrorMessage';
import { installManagedSkillAsset } from '../lens/MindBootstrap';
import type { MarketplaceSkillCatalog } from './MarketplaceSkillCatalog';
import type { MarketplaceSkillMaterializer } from './MarketplaceSkillMaterializer';
import type { ManagedSkillAsset } from './skillTypes';

const log = Logger.create('ManagedSkillService');
const CORE_SKILL_IDS = new Set(['lens', 'automation', 'ttasks']);

export interface ManagedSkillSyncError {
  marketplaceId: string;
  message: string;
  skillId?: string;
}

export interface ManagedSkillSyncResult {
  status: 'ok' | 'degraded';
  installed: string[];
  errors: ManagedSkillSyncError[];
}

export class ManagedSkillService {
  private cachedAssets: ManagedSkillAsset[] = [];
  private refreshPromise: Promise<ManagedSkillSyncResult> | null = null;

  constructor(
    private readonly catalog: Pick<MarketplaceSkillCatalog, 'listSkills'>,
    private readonly materializer: Pick<MarketplaceSkillMaterializer, 'materialize'>,
    private readonly installAsset: (mindPath: string, asset: ManagedSkillAsset) => void = installManagedSkillAsset,
  ) {}

  async refresh(): Promise<ManagedSkillSyncResult> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.doRefresh();
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  async installIntoMind(mindPath: string): Promise<ManagedSkillSyncResult> {
    const result = this.cachedAssets.length > 0
      ? { status: 'ok' as const, installed: this.cachedAssets.map((asset) => asset.manifest.name), errors: [] }
      : await this.refresh();

    for (const asset of this.cachedAssets) {
      try {
        this.installAsset(mindPath, asset);
      } catch (error) {
        log.warn(`Managed skill install failed for ${asset.manifest.name}: ${getErrorMessage(error)}`);
      }
    }

    return result;
  }

  private async doRefresh(): Promise<ManagedSkillSyncResult> {
    const result = await this.catalog.listSkills();
    const errors: ManagedSkillSyncError[] = [...result.errors];
    const assets: ManagedSkillAsset[] = [];

    for (const skill of result.skills.filter((entry) => entry.reserved && CORE_SKILL_IDS.has(entry.id))) {
      try {
        assets.push(await this.materializer.materialize(skill));
      } catch (error) {
        errors.push({
          marketplaceId: skill.source.marketplaceId,
          skillId: skill.id,
          message: getErrorMessage(error),
        });
      }
    }

    if (assets.length > 0) {
      this.cachedAssets = assets;
    }

    return {
      status: errors.length > 0 ? 'degraded' : 'ok',
      installed: assets.map((asset) => asset.manifest.name),
      errors,
    };
  }
}
