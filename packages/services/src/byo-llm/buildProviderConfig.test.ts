import { describe, it, expect } from 'vitest';
import { buildProviderConfig } from './buildProviderConfig';
import type { ByoLlmConfig } from '@chamber/shared/types';

describe('buildProviderConfig', () => {
  it('BVT-PC01: returns null when config is null', () => {
    expect(buildProviderConfig(null)).toBeNull();
    expect(buildProviderConfig(undefined)).toBeNull();
  });

  it('BVT-PC02: returns null when disabled', () => {
    const config: ByoLlmConfig = { enabled: false, baseUrl: 'https://x/v1' };
    expect(buildProviderConfig(config)).toBeNull();
  });

  it('BVT-PC03: returns null when baseUrl missing or whitespace', () => {
    expect(buildProviderConfig({ enabled: true, baseUrl: '' } as ByoLlmConfig)).toBeNull();
    expect(buildProviderConfig({ enabled: true, baseUrl: '   ' } as ByoLlmConfig)).toBeNull();
  });

  it('BVT-PC04: maps minimal config to ProviderConfig with defaults', () => {
    const config: ByoLlmConfig = { enabled: true, baseUrl: 'https://x/v1' };
    expect(buildProviderConfig(config)).toEqual({
      type: 'openai',
      baseUrl: 'https://x/v1',
    });
  });

  it('BVT-PC05: trims baseUrl whitespace', () => {
    const config: ByoLlmConfig = { enabled: true, baseUrl: '  https://x/v1  ' };
    expect(buildProviderConfig(config)?.baseUrl).toBe('https://x/v1');
  });

  it('BVT-PC06: prefers bearerToken over apiKey when both set', () => {
    const config: ByoLlmConfig = { enabled: true, baseUrl: 'https://x/v1', apiKey: 'k', bearerToken: 't' };
    const result = buildProviderConfig(config);
    expect(result?.bearerToken).toBe('t');
    expect(result?.apiKey).toBeUndefined();
  });

  it('BVT-PC07: passes apiKey when bearerToken absent', () => {
    const config: ByoLlmConfig = { enabled: true, baseUrl: 'https://x/v1', apiKey: 'lm-studio' };
    const result = buildProviderConfig(config);
    expect(result?.apiKey).toBe('lm-studio');
    expect(result?.bearerToken).toBeUndefined();
  });

  it('BVT-PC08: includes wireApi when set', () => {
    const config: ByoLlmConfig = { enabled: true, baseUrl: 'https://x/v1', wireApi: 'responses' };
    expect(buildProviderConfig(config)?.wireApi).toBe('responses');
  });

  it('BVT-PC08b: includes positive token limits when set', () => {
    const config: ByoLlmConfig = {
      enabled: true,
      baseUrl: 'https://x/v1',
      maxPromptTokens: 4096,
      maxOutputTokens: 1024,
    };
    expect(buildProviderConfig(config)).toEqual({
      type: 'openai',
      baseUrl: 'https://x/v1',
      maxPromptTokens: 4096,
      maxOutputTokens: 1024,
    });
  });

  it('BVT-PC08c: drops invalid token limits', () => {
    const config: ByoLlmConfig = {
      enabled: true,
      baseUrl: 'https://x/v1',
      maxPromptTokens: 0,
      maxOutputTokens: -1,
    };
    expect(buildProviderConfig(config)).toEqual({
      type: 'openai',
      baseUrl: 'https://x/v1',
    });
  });

  it('BVT-PC09: includes customHeaders when present', () => {
    const config: ByoLlmConfig = {
      enabled: true,
      baseUrl: 'https://x/v1',
      customHeaders: { 'X-Tunnel-Skip-AntiPhishing-Page': 'true' },
    };
    expect(buildProviderConfig(config)?.headers).toEqual({ 'X-Tunnel-Skip-AntiPhishing-Page': 'true' });
  });

  it('BVT-PC10: drops empty/non-string customHeader values', () => {
    const config: ByoLlmConfig = {
      enabled: true,
      baseUrl: 'https://x/v1',
      customHeaders: { 'X-Good': 'yes', 'X-Empty': '' },
    };
    expect(buildProviderConfig(config)?.headers).toEqual({ 'X-Good': 'yes' });
  });

  it('BVT-PC11: omits headers field when no valid customHeaders', () => {
    const config: ByoLlmConfig = {
      enabled: true,
      baseUrl: 'https://x/v1',
      customHeaders: { 'X-Empty': '' },
    };
    const result = buildProviderConfig(config);
    expect(result?.headers).toBeUndefined();
  });

  it('BVT-PC12: providerType defaults to openai when omitted', () => {
    const config: ByoLlmConfig = { enabled: true, baseUrl: 'https://x/v1' };
    expect(buildProviderConfig(config)?.type).toBe('openai');
  });

  it('BVT-PC13: providerType passes through azure/anthropic', () => {
    const azure = buildProviderConfig({ enabled: true, baseUrl: 'https://x/v1', providerType: 'azure' });
    expect(azure?.type).toBe('azure');
    const ant = buildProviderConfig({ enabled: true, baseUrl: 'https://x/v1', providerType: 'anthropic' });
    expect(ant?.type).toBe('anthropic');
  });

  it('BVT-PC13b: maps Azure API version into provider config', () => {
    const azure = buildProviderConfig({
      enabled: true,
      baseUrl: 'https://x/v1',
      providerType: 'azure',
      azureApiVersion: ' 2024-10-21 ',
    });
    expect(azure?.azure).toEqual({ apiVersion: '2024-10-21' });
  });

  it('BVT-PC14: full config with all fields builds complete ProviderConfig', () => {
    const config: ByoLlmConfig = {
      enabled: true,
      baseUrl: 'https://7fwshbxx-18081.usw3.devtunnels.ms/v1',
      providerType: 'openai',
      wireApi: 'completions',
      azureApiVersion: '2024-10-21',
      apiKey: 'lm-studio',
      model: 'google/gemma-4-e4b',
      customHeaders: { 'X-Tunnel-Skip-AntiPhishing-Page': 'true' },
      maxPromptTokens: 131072,
      maxOutputTokens: 1024,
    };
    expect(buildProviderConfig(config)).toEqual({
      type: 'openai',
      wireApi: 'completions',
      baseUrl: 'https://7fwshbxx-18081.usw3.devtunnels.ms/v1',
      apiKey: 'lm-studio',
      headers: { 'X-Tunnel-Skip-AntiPhishing-Page': 'true' },
      maxPromptTokens: 131072,
      maxOutputTokens: 1024,
    });
  });
});
