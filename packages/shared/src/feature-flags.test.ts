import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_FEATURE_FLAGS, getAppFeatureFlags, isInsidersVersion } from './feature-flags';

describe('feature flags', () => {
  it('keeps preview features disabled by default', () => {
    expect(DEFAULT_APP_FEATURE_FLAGS.switchboardRelay).toBe(false);
    expect(DEFAULT_APP_FEATURE_FLAGS.byoLlm).toBe(false);
  });

  it('enables preview features for insiders versions', () => {
    expect(getAppFeatureFlags({ version: '0.62.4-insiders.7' })).toEqual({
      switchboardRelay: true,
      byoLlm: true,
    });
  });

  it('keeps preview features disabled for stable versions', () => {
    expect(getAppFeatureFlags({ version: '0.62.4' })).toEqual(DEFAULT_APP_FEATURE_FLAGS);
  });

  it('can force preview features for E2E without changing the version shape', () => {
    expect(getAppFeatureFlags({ version: '0.62.4', previewFeatures: true })).toEqual({
      switchboardRelay: true,
      byoLlm: true,
    });
  });

  it('detects insiders prerelease versions only', () => {
    expect(isInsidersVersion('0.62.4-insiders.0')).toBe(true);
    expect(isInsidersVersion('0.62.4-beta.0')).toBe(false);
    expect(isInsidersVersion('0.62.4')).toBe(false);
  });
});
