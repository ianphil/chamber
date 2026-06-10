import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { generateMindId } from '../mind';
import type { AppConfig, AppConfigV1, ChamberConversationRecord, InstalledTool, MarketplaceRegistry, MindRecord, UserProfile } from '@chamber/shared/types';

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

  getConfigDir(): string {
    return this.configDir;
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
    const installedTools = normalizeInstalledTools(raw.installedTools);
    const userProfile = normalizeUserProfile(raw.userProfile);
    return this.deduplicateMinds({
      version: 2,
      minds,
      activeMindId: typeof raw.activeMindId === 'string' ? raw.activeMindId : null,
      activeLogin: typeof raw.activeLogin === 'string' ? raw.activeLogin : null,
      theme,
      ...(userProfile ? { userProfile } : {}),
      marketplaceRegistries: this.normalizeMarketplaceRegistries(raw.marketplaceRegistries),
      ...(installedTools.length > 0 ? { installedTools } : {}),
      ...(typeof raw.a2aRelayBaseUrl === 'string' && raw.a2aRelayBaseUrl.trim().length > 0
        ? { a2aRelayBaseUrl: raw.a2aRelayBaseUrl.trim() }
        : {}),
      ...(raw.a2aRelayAuthMode === 'static' || raw.a2aRelayAuthMode === 'interactive'
        ? { a2aRelayAuthMode: raw.a2aRelayAuthMode }
        : {}),
      ...(typeof raw.chamberPlugin === 'string' && raw.chamberPlugin.trim().length > 0
        ? { chamberPlugin: raw.chamberPlugin.trim() }
        : {}),
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

function normalizeUserProfile(value: unknown): UserProfile | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  return {
    displayName: stringValue(record.displayName),
    work: stringValue(record.work),
    location: stringValue(record.location),
    about: stringValue(record.about),
    avatarDataUrl: typeof record.avatarDataUrl === 'string' && record.avatarDataUrl.startsWith('data:image/')
      ? record.avatarDataUrl
      : null,
    source: record.source === 'microsoft' ? 'microsoft' : 'local',
    ...(typeof record.microsoftAccount === 'string' && record.microsoftAccount.trim().length > 0
      ? { microsoftAccount: record.microsoftAccount.trim() }
      : {}),
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : null,
  };
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
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
    ...(record.selectedModelProvider === 'byo'
      ? { selectedModelProvider: record.selectedModelProvider }
      : {}),
    ...(typeof record.activeSessionId === 'string' && record.activeSessionId.trim().length > 0
      ? { activeSessionId: record.activeSessionId.trim() }
      : {}),
    ...(Array.isArray(record.conversations)
      ? { conversations: record.conversations.map(normalizeConversationRecord).filter((conversation): conversation is ChamberConversationRecord => conversation !== null) }
      : {}),
  };
}

function normalizeConversationRecord(value: unknown): ChamberConversationRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const kind = record.kind === 'cron' || record.kind === 'task' ? record.kind : 'chat';
  if (
    typeof record.sessionId !== 'string'
    || typeof record.createdAt !== 'string'
    || typeof record.updatedAt !== 'string'
  ) {
    return null;
  }
  return {
    sessionId: record.sessionId,
    ...(typeof record.title === 'string' && record.title.trim().length > 0
      ? { title: record.title.trim() }
      : {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    kind,
    ...(typeof record.hasMessages === 'boolean' ? { hasMessages: record.hasMessages } : {}),
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

function normalizeInstalledTools(raw: unknown): InstalledTool[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const tools: InstalledTool[] = [];
  for (const value of raw) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
    const record = value as Record<string, unknown>;
    if (!hasBaseInstalledToolFields(record)) continue;
    const source = record.source;
    if (typeof source !== 'object' || source === null || Array.isArray(source)) continue;
    const sourceRecord = source as Record<string, unknown>;
    if (typeof sourceRecord.marketplaceId !== 'string' || typeof sourceRecord.pluginId !== 'string') {
      continue;
    }
    if (seen.has(record.id)) continue;
    const install = normalizeInstalledToolInstall(record);
    if (!install) continue;
    seen.add(record.id);
    const base = {
      id: record.id,
      version: record.version,
      bin: record.bin,
      displayName: record.displayName,
      description: record.description,
      ...(typeof record.help === 'string' ? { help: record.help } : {}),
      ...(typeof record.agentInstructions === 'string' ? { agentInstructions: record.agentInstructions } : {}),
      source: { marketplaceId: sourceRecord.marketplaceId, pluginId: sourceRecord.pluginId },
      installedAt: record.installedAt,
    };
    if (install.type === 'npm-global') {
      tools.push({
        ...base,
        package: install.package,
        install,
      });
    } else {
      tools.push({
        ...base,
        install,
      });
    }
  }
  return tools;
}

function hasBaseInstalledToolFields(record: Record<string, unknown>): record is Record<string, unknown> & {
  id: string;
  version: string;
  bin: string;
  installedAt: string;
  displayName: string;
  description: string;
} {
  return typeof record.id === 'string'
    && typeof record.version === 'string'
    && typeof record.bin === 'string'
    && typeof record.installedAt === 'string'
    && typeof record.displayName === 'string'
    && typeof record.description === 'string';
}

function normalizeInstalledToolInstall(record: Record<string, unknown>): InstalledTool['install'] | null {
  const install = record.install;
  if (typeof install === 'object' && install !== null && !Array.isArray(install)) {
    const installRecord = install as Record<string, unknown>;
    if (installRecord.type === 'npm-global'
      && typeof installRecord.package === 'string'
      && typeof installRecord.version === 'string') {
      return { type: 'npm-global', package: installRecord.package, version: installRecord.version };
    }
    if (installRecord.type === 'github-release-asset'
      && typeof installRecord.owner === 'string'
      && typeof installRecord.repo === 'string'
      && typeof installRecord.tag === 'string'
      && typeof installRecord.assetName === 'string'
      && typeof installRecord.sha256 === 'string'
      && typeof installRecord.platform === 'string'
      && typeof installRecord.arch === 'string'
      && typeof installRecord.installedPath === 'string') {
      return {
        type: 'github-release-asset',
        owner: installRecord.owner,
        repo: installRecord.repo,
        tag: installRecord.tag,
        assetName: installRecord.assetName,
        sha256: installRecord.sha256,
        platform: installRecord.platform,
        arch: installRecord.arch,
        installedPath: installRecord.installedPath,
        ...(installRecord.archive === 'zip' || installRecord.archive === 'tar.gz' ? { archive: installRecord.archive } : {}),
        ...(typeof installRecord.binPath === 'string' ? { binPath: installRecord.binPath } : {}),
      };
    }
    return null;
  }
  if (typeof record.package === 'string') {
    return { type: 'npm-global', package: record.package, version: record.version as string };
  }
  return null;
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
