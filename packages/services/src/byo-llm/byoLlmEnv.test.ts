import { describe, it, expect } from 'vitest';
import type { ByoLlmConfig } from '@chamber/shared/types';

import { buildByoLlmEnv } from './byoLlmEnv';

const baseConfig: ByoLlmConfig = {
  enabled: true,
  baseUrl: 'https://example.com/v1',
};

describe('buildByoLlmEnv', () => {
  it('BVT-01: returns empty object for null config', () => {
    expect(buildByoLlmEnv(null)).toEqual({});
  });

  it('BVT-02: returns empty object when disabled', () => {
    expect(buildByoLlmEnv({ ...baseConfig, enabled: false })).toEqual({});
  });

  it('BVT-03: returns empty object when baseUrl is missing or whitespace', () => {
    expect(buildByoLlmEnv({ ...baseConfig, baseUrl: '' })).toEqual({});
    expect(buildByoLlmEnv({ ...baseConfig, baseUrl: '   ' })).toEqual({});
  });

  it('BVT-04: emits BASE_URL and defaults TYPE to openai', () => {
    const env = buildByoLlmEnv(baseConfig);
    expect(env.COPILOT_PROVIDER_BASE_URL).toBe('https://example.com/v1');
    expect(env.COPILOT_PROVIDER_TYPE).toBe('openai');
  });

  it('BVT-05: trims surrounding whitespace from baseUrl', () => {
    const env = buildByoLlmEnv({ ...baseConfig, baseUrl: '  https://example.com/v1  ' });
    expect(env.COPILOT_PROVIDER_BASE_URL).toBe('https://example.com/v1');
  });

  it('BVT-06: bearer token takes precedence over apiKey', () => {
    const env = buildByoLlmEnv({ ...baseConfig, apiKey: 'k', bearerToken: 'b' });
    expect(env.COPILOT_PROVIDER_BEARER_TOKEN).toBe('b');
    expect(env.COPILOT_PROVIDER_API_KEY).toBeUndefined();
  });

  it('BVT-07: emits API_KEY when only apiKey provided', () => {
    const env = buildByoLlmEnv({ ...baseConfig, apiKey: 'lm-studio' });
    expect(env.COPILOT_PROVIDER_API_KEY).toBe('lm-studio');
    expect(env.COPILOT_PROVIDER_BEARER_TOKEN).toBeUndefined();
  });

  it('BVT-08: omits empty apiKey/bearerToken values', () => {
    const env = buildByoLlmEnv({ ...baseConfig, apiKey: '', bearerToken: '' });
    expect(env.COPILOT_PROVIDER_API_KEY).toBeUndefined();
    expect(env.COPILOT_PROVIDER_BEARER_TOKEN).toBeUndefined();
  });

  it('BVT-09: maps all model and wire fields when provided', () => {
    const env = buildByoLlmEnv({
      ...baseConfig,
      providerType: 'azure',
      model: 'gpt-4-deployment',
      modelId: 'gpt-4',
      wireModel: 'my-azure-deployment',
      wireApi: 'responses',
      maxPromptTokens: 32000,
      maxOutputTokens: 4096,
    });
    expect(env.COPILOT_PROVIDER_TYPE).toBe('azure');
    expect(env.COPILOT_MODEL).toBe('gpt-4-deployment');
    expect(env.COPILOT_PROVIDER_MODEL_ID).toBe('gpt-4');
    expect(env.COPILOT_PROVIDER_WIRE_MODEL).toBe('my-azure-deployment');
    expect(env.COPILOT_PROVIDER_WIRE_API).toBe('responses');
    expect(env.COPILOT_PROVIDER_MAX_PROMPT_TOKENS).toBe('32000');
    expect(env.COPILOT_PROVIDER_MAX_OUTPUT_TOKENS).toBe('4096');
  });

  it('BVT-10: omits zero or negative max-token values', () => {
    const env = buildByoLlmEnv({
      ...baseConfig,
      maxPromptTokens: 0,
      maxOutputTokens: -1,
    });
    expect(env.COPILOT_PROVIDER_MAX_PROMPT_TOKENS).toBeUndefined();
    expect(env.COPILOT_PROVIDER_MAX_OUTPUT_TOKENS).toBeUndefined();
  });

  it('BVT-11: does not leak between calls (returns fresh object)', () => {
    const a = buildByoLlmEnv(baseConfig);
    const b = buildByoLlmEnv({ ...baseConfig, model: 'gemma' });
    expect(a.COPILOT_MODEL).toBeUndefined();
    expect(b.COPILOT_MODEL).toBe('gemma');
    expect(a).not.toBe(b);
  });
});
