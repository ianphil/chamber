import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_APP_FEATURE_FLAGS,
  getAppFeatureFlags,
  getFeatureFlagChannel,
  parseCompleteFeatureFlags,
  parseRemoteFeatureFlagPolicy,
  type AppFeatureFlags,
  type FeatureFlagChannel,
} from '@chamber/shared/feature-flags';

const DEFAULT_POLICY_URL = 'https://chmbr.dev/flags/v1/flags.json';
const DEFAULT_FETCH_TIMEOUT_MS = 3_000;

export interface FeatureFlagServiceOptions {
  version: string;
  isPackaged: boolean;
  userDataPath: string;
  devFeatureFlags: AppFeatureFlags;
  previewFeatures?: boolean;
  policyUrl?: string;
  fetchTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class FeatureFlagService {
  private flags: AppFeatureFlags = DEFAULT_APP_FEATURE_FLAGS;
  private readonly channel: FeatureFlagChannel;
  private readonly policyUrl: string;
  private readonly fetchTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: FeatureFlagServiceOptions) {
    this.channel = getFeatureFlagChannel(options.version);
    this.policyUrl = options.policyUrl ?? DEFAULT_POLICY_URL;
    this.fetchTimeoutMs = options.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async initialize(): Promise<AppFeatureFlags> {
    if (!this.options.isPackaged || this.options.previewFeatures === true) {
      this.flags = getAppFeatureFlags({
        version: this.options.version,
        devFeatureFlags: this.options.previewFeatures === true ? undefined : this.options.devFeatureFlags,
        previewFeatures: this.options.previewFeatures,
      });
      return this.flags;
    }

    const remoteFlags = await this.fetchRemoteFlags().catch(() => null);
    if (remoteFlags) {
      this.flags = remoteFlags;
      await this.writeCachedFlags(remoteFlags).catch(() => undefined);
      return this.flags;
    }

    const cachedFlags = await this.readCachedFlags().catch(() => null);
    this.flags = cachedFlags ?? DEFAULT_APP_FEATURE_FLAGS;
    return this.flags;
  }

  getFlags(): AppFeatureFlags {
    return this.flags;
  }

  getChannel(): FeatureFlagChannel {
    return this.channel;
  }

  private async fetchRemoteFlags(): Promise<AppFeatureFlags | null> {
    const url = new URL(this.policyUrl);
    if (url.protocol !== 'https:') {
      throw new Error(`Feature flag policy URL must use HTTPS: ${this.policyUrl}`);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.fetchTimeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        signal: controller.signal,
        redirect: 'error',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) return null;
      const policy = parseRemoteFeatureFlagPolicy(await response.json());
      return policy?.channels[this.channel] ?? null;
    } finally {
      clearTimeout(timer);
    }
  }

  private get cachePath(): string {
    return path.join(this.options.userDataPath, 'feature-flags', `${this.channel}.json`);
  }

  private async readCachedFlags(): Promise<AppFeatureFlags | null> {
    const raw = await fs.readFile(this.cachePath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parseCompleteFeatureFlags((parsed as Record<string, unknown>).flags);
  }

  private async writeCachedFlags(flags: AppFeatureFlags): Promise<void> {
    const filePath = this.cachePath;
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify({
      version: 1,
      channel: this.channel,
      cachedAt: new Date().toISOString(),
      flags,
    }, null, 2)}\n`);
    await fs.rename(tempPath, filePath);
  }
}
