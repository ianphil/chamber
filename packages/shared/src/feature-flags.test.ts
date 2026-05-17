import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_FEATURE_FLAGS, getAppFeatureFlags, isInsidersVersion } from './feature-flags';

describe('feature flags', () => {
  it('keeps Switchboard Relay disabled by default', () => {
    expect(DEFAULT_APP_FEATURE_FLAGS.switchboardRelay).toBe(false);
  });

  it('enables Switchboard Relay for insiders versions', () => {
    expect(getAppFeatureFlags({ version: '0.62.4-insiders.7' }).switchboardRelay).toBe(true);
  });

  it('keeps Switchboard Relay disabled for stable versions', () => {
    expect(getAppFeatureFlags({ version: '0.62.4' }).switchboardRelay).toBe(false);
  });

  it('detects insiders prerelease versions only', () => {
    expect(isInsidersVersion('0.62.4-insiders.0')).toBe(true);
    expect(isInsidersVersion('0.62.4-beta.0')).toBe(false);
    expect(isInsidersVersion('0.62.4')).toBe(false);
  });
});
