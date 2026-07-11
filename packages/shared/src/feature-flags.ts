export interface AppFeatureFlags {
  readonly switchboardRelay: boolean;
  readonly byoLlm: boolean;
  readonly chamberCopilot: boolean;
  readonly voiceDictation: boolean;
  readonly wtdTopology: boolean;
}

export type FeatureFlagChannel = 'stable' | 'insiders';

export interface RemoteFeatureFlagPolicy {
  readonly version: 1;
  readonly updatedAt?: string;
  readonly channels: Record<FeatureFlagChannel, AppFeatureFlags>;
}

export const DEFAULT_APP_FEATURE_FLAGS: AppFeatureFlags = {
  switchboardRelay: false,
  byoLlm: false,
  chamberCopilot: false,
  voiceDictation: false,
  wtdTopology: false,
};

export function getAppFeatureFlags(options: {
  version: string;
  devFeatureFlags?: AppFeatureFlags;
  previewFeatures?: boolean;
}): AppFeatureFlags {
  if (options.devFeatureFlags) return options.devFeatureFlags;
  const insiders = options.previewFeatures === true || isInsidersVersion(options.version);
  return {
    switchboardRelay: insiders,
    byoLlm: insiders,
    chamberCopilot: insiders,
    voiceDictation: insiders,
    wtdTopology: insiders,
  };
}

export function isInsidersVersion(version: string): boolean {
  return /(?:^|-)insiders(?:\.|$)/.test(version);
}

export function getFeatureFlagChannel(version: string): FeatureFlagChannel {
  return isInsidersVersion(version) ? 'insiders' : 'stable';
}

export function parseRemoteFeatureFlagPolicy(value: unknown): RemoteFeatureFlagPolicy | null {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.channels)) {
    return null;
  }
  const stable = parseCompleteFeatureFlags(value.channels.stable);
  const insiders = parseCompleteFeatureFlags(value.channels.insiders);
  if (!stable || !insiders) return null;
  return {
    version: 1,
    ...(typeof value.updatedAt === 'string' ? { updatedAt: value.updatedAt } : {}),
    channels: { stable, insiders },
  };
}

export function parseFeatureFlags(value: unknown): AppFeatureFlags | null {
  if (!isRecord(value)) return null;
  return {
    switchboardRelay: value.switchboardRelay === true,
    byoLlm: value.byoLlm === true,
    chamberCopilot: value.chamberCopilot === true,
    voiceDictation: value.voiceDictation === true,
    wtdTopology: value.wtdTopology === true,
  };
}

export function parseCompleteFeatureFlags(value: unknown): AppFeatureFlags | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.switchboardRelay !== 'boolean' ||
    typeof value.byoLlm !== 'boolean' ||
    typeof value.chamberCopilot !== 'boolean' ||
    (value.voiceDictation !== undefined && typeof value.voiceDictation !== 'boolean') ||
    (value.wtdTopology !== undefined && typeof value.wtdTopology !== 'boolean')
  ) {
    return null;
  }
  return {
    switchboardRelay: value.switchboardRelay,
    byoLlm: value.byoLlm,
    chamberCopilot: value.chamberCopilot,
    voiceDictation: value.voiceDictation === true,
    wtdTopology: value.wtdTopology === true,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
