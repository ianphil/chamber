export interface AppFeatureFlags {
  readonly switchboardRelay: boolean;
}

export const DEFAULT_APP_FEATURE_FLAGS: AppFeatureFlags = {
  switchboardRelay: false,
};

export function getAppFeatureFlags(options: { version: string }): AppFeatureFlags {
  return {
    switchboardRelay: isInsidersVersion(options.version),
  };
}

export function isInsidersVersion(version: string): boolean {
  return /(?:^|-)insiders(?:\.|$)/.test(version);
}
