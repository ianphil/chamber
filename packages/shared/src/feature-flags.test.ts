import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_APP_FEATURE_FLAGS,
  getAppFeatureFlags,
  getFeatureFlagChannel,
  isInsidersVersion,
  parseFeatureFlags,
  parseRemoteFeatureFlagPolicy,
} from './feature-flags';

describe('feature flags', () => {
  it('keeps preview features disabled by default', () => {
    expect(DEFAULT_APP_FEATURE_FLAGS.switchboardRelay).toBe(false);
    expect(DEFAULT_APP_FEATURE_FLAGS.byoLlm).toBe(false);
    expect(DEFAULT_APP_FEATURE_FLAGS.voiceDictation).toBe(false);
  });

  it('enables preview features for insiders versions', () => {
    expect(getAppFeatureFlags({ version: '0.62.4-insiders.7' })).toEqual({
      switchboardRelay: true,
      byoLlm: true,
      chamberCopilot: true,
      voiceDictation: true,
    });
  });

  it('keeps preview features disabled for stable versions', () => {
    expect(getAppFeatureFlags({ version: '0.62.4' })).toEqual(DEFAULT_APP_FEATURE_FLAGS);
  });

  it('can force preview features for E2E without changing the version shape', () => {
    expect(getAppFeatureFlags({ version: '0.62.4', previewFeatures: true })).toEqual({
      switchboardRelay: true,
      byoLlm: true,
      chamberCopilot: true,
      voiceDictation: true,
    });
  });

  it('uses explicit dev flags before channel-derived rules', () => {
    expect(getAppFeatureFlags({
      version: '0.62.4-insiders.7',
      devFeatureFlags: {
        switchboardRelay: false,
        byoLlm: true,
        chamberCopilot: false,
        voiceDictation: true,
      },
    })).toEqual({
      switchboardRelay: false,
      byoLlm: true,
      chamberCopilot: false,
      voiceDictation: true,
    });
  });

  it('detects insiders prerelease versions only', () => {
    expect(isInsidersVersion('0.62.4-insiders.0')).toBe(true);
    expect(isInsidersVersion('0.62.4-beta.0')).toBe(false);
    expect(isInsidersVersion('0.62.4')).toBe(false);
  });

  it('maps versions to feature flag channels', () => {
    expect(getFeatureFlagChannel('0.62.4-insiders.0')).toBe('insiders');
    expect(getFeatureFlagChannel('0.62.4')).toBe('stable');
  });

  it('parses feature flags with missing known fields defaulted off and unknown fields ignored', () => {
    expect(parseFeatureFlags({ switchboardRelay: true, unknownFlag: true })).toEqual({
      switchboardRelay: true,
      byoLlm: false,
      chamberCopilot: false,
      voiceDictation: false,
    });
  });

  it('parses a valid remote policy', () => {
    expect(parseRemoteFeatureFlagPolicy({
      version: 1,
      updatedAt: '2026-05-17T21:00:00Z',
      ignored: true,
      channels: {
        stable: { switchboardRelay: false, byoLlm: false, chamberCopilot: false, voiceDictation: false },
        insiders: { switchboardRelay: true, byoLlm: true, chamberCopilot: true, voiceDictation: true, futureFlag: true },
      },
    })).toEqual({
      version: 1,
      updatedAt: '2026-05-17T21:00:00Z',
      channels: {
        stable: DEFAULT_APP_FEATURE_FLAGS,
        insiders: { switchboardRelay: true, byoLlm: true, chamberCopilot: true, voiceDictation: true },
      },
    });
  });

  it('rejects malformed remote policies', () => {
    expect(parseRemoteFeatureFlagPolicy({ version: 2, channels: {} })).toBeNull();
    expect(parseRemoteFeatureFlagPolicy({ version: 1, channels: { stable: {} } })).toBeNull();
    expect(parseRemoteFeatureFlagPolicy(null)).toBeNull();
  });

  it('keeps the published GitHub Pages policy valid', () => {
    const policyPath = path.resolve(process.cwd(), 'docs', 'flags', 'v1', 'flags.json');
    const policy = parseRemoteFeatureFlagPolicy(JSON.parse(fs.readFileSync(policyPath, 'utf-8')) as unknown);

    expect(policy).toEqual({
      version: 1,
      updatedAt: '2026-05-17T21:00:00Z',
      channels: {
        stable: DEFAULT_APP_FEATURE_FLAGS,
        insiders: { switchboardRelay: true, byoLlm: true, chamberCopilot: true, voiceDictation: true },
      },
    });
  });
});
