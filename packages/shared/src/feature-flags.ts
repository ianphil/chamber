export interface AppFeatureFlags {
  readonly switchboardRelay: boolean;
  readonly byoLlm: boolean;
  readonly chamberCopilot: boolean;
}

export const DEFAULT_APP_FEATURE_FLAGS: AppFeatureFlags = {
  switchboardRelay: false,
  byoLlm: false,
  chamberCopilot: false,
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
  };
}

export function isInsidersVersion(version: string): boolean {
  return /(?:^|-)insiders(?:\.|$)/.test(version);
}
