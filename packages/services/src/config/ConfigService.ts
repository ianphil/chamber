import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { generateMindId } from '../mind';
import type { AppConfig, AppConfigV1, MarketplaceRegistry, MindRecord } from '@chamber/shared/types';

const CONFIG_DIR = path.join(os.homedir(), '.chamber');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

export const DEFAULT_MARKETPLACE_REGISTRY: MarketplaceRegistry = {
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

const DEFAULT_CONFIG: AppConfig = {
  version: 2,
  minds: [],
  activeMindId: null,
  activeLogin: null,
  theme: 'dark',
  marketplaceRegistries: [DEFAULT_MARKETPLACE_REGISTRY],
};

export class ConfigService {
  private readonly configDir: string;
  private readonly configPath: string;

  constructor(configDir = process.env.CHAMBER_E2E_USER_DATA ?? CONFIG_DIR) {
    this.configDir = configDir;
    this.configPath = configDir === CONFIG_DIR ? CONFIG_PATH : path.join(configDir, 'config.json');
  }

  load(): AppConfig {
    try {
      const data = fs.readFileSync(this.configPath, 'utf-8');
      const raw = JSON.parse(data);
      return this.normalize(raw);
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  save(config: AppConfig): void {
    fs.mkdirSync(this.configDir, { recursive: true });
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
  }

  private normalize(raw: Record<string, unknown>): AppConfig {
    if (raw.version === 2) {
      return this.normalizeV2(raw);
    }
    return this.migrateV1(raw as unknown as AppConfigV1);
  }

  private normalizeV2(raw: Record<string, unknown>): AppConfig {
    const theme = raw.theme === 'light' || raw.theme === 'dark' || raw.theme === 'system'
      ? raw.theme
      : 'dark';
    const minds = Array.isArray(raw.minds)
      ? raw.minds.map(normalizeMindRecord).filter((record): record is MindRecord => record !== null)
      : [];
    return this.deduplicateMinds({
      version: 2,
      minds,
      activeMindId: typeof raw.activeMindId === 'string' ? raw.activeMindId : null,
      activeLogin: typeof raw.activeLogin === 'string' ? raw.activeLogin : null,
      theme,
      marketplaceRegistries: this.normalizeMarketplaceRegistries(raw.marketplaceRegistries),
    });
  }

  private migrateV1(v1: AppConfigV1): AppConfig {
    if (!v1.mindPath) {
      return { ...DEFAULT_CONFIG, theme: v1.theme ?? 'dark' };
    }
    const id = generateMindId(v1.mindPath);
    return {
      version: 2,
      minds: [{ id, path: v1.mindPath }],
      activeMindId: id,
      activeLogin: null,
      theme: v1.theme ?? 'dark',
      marketplaceRegistries: [DEFAULT_MARKETPLACE_REGISTRY],
    };
  }

  private normalizeMarketplaceRegistries(raw: unknown): MarketplaceRegistry[] {
    const registries = Array.isArray(raw)
      ? raw.filter(isMarketplaceRegistry)
      : [];
    return deduplicateRegistries([...registries, DEFAULT_MARKETPLACE_REGISTRY]);
  }

  private deduplicateMinds(config: AppConfig): AppConfig {
    const seen = new Set<string>();
    const deduped: MindRecord[] = [];
    for (const mind of config.minds) {
      if (!seen.has(mind.path)) {
        seen.add(mind.path);
        deduped.push({ ...mind });
      }
    }
    return { ...config, minds: deduped };
  }
}

function normalizeMindRecord(value: unknown): MindRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || typeof record.path !== 'string') return null;
  return {
    id: record.id,
    path: record.path,
    ...(typeof record.selectedModel === 'string' && record.selectedModel.trim().length > 0
      ? { selectedModel: record.selectedModel.trim() }
      : {}),
  };
}

function isMarketplaceRegistry(value: unknown): value is MarketplaceRegistry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string'
    && typeof record.label === 'string'
    && typeof record.url === 'string'
    && typeof record.owner === 'string'
    && typeof record.repo === 'string'
    && typeof record.ref === 'string'
    && typeof record.plugin === 'string'
    && typeof record.enabled === 'boolean'
    && typeof record.isDefault === 'boolean';
}

function deduplicateRegistries(registries: MarketplaceRegistry[]): MarketplaceRegistry[] {
  const seen = new Set<string>();
  const deduped: MarketplaceRegistry[] = [];
  for (const registry of registries) {
    if (seen.has(registry.id)) continue;
    seen.add(registry.id);
    deduped.push({ ...registry });
  }
  return deduped;
}
