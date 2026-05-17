export interface AppFeatureFlags {
  readonly switchboardRelay: boolean;
  readonly byoLlm: boolean;
}

export const DEFAULT_APP_FEATURE_FLAGS: AppFeatureFlags = {
  switchboardRelay: false,
  byoLlm: false,
};

export function getAppFeatureFlags(options: { version: string; previewFeatures?: boolean }): AppFeatureFlags {
  const insiders = options.previewFeatures === true || isInsidersVersion(options.version);
  return {
    switchboardRelay: insiders,
    byoLlm: insiders,
  };
}

export function isInsidersVersion(version: string): boolean {
  return /(?:^|-)insiders(?:\.|$)/.test(version);
}
