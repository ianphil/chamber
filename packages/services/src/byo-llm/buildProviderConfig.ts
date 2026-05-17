import type { ByoLlmConfig, ByoLlmProviderType, ByoLlmWireApi } from '@chamber/shared/types';

/**
 * Map a {@link ByoLlmConfig} to the GitHub Copilot SDK's `ProviderConfig` shape.
 *
 * This is the AUTHORITATIVE way to enable BYOK in the SDK
 * (`client.createSession({ provider, model })`). The CLI's COPILOT_PROVIDER_*
 * env-var path only activates BYOK for standalone CLI invocations — the SDK's
 * server-mode createSession path requires the `provider` field on SessionConfig
 * and ignores those env vars.
 *
 * Source of truth:
 *   https://github.com/github/copilot-sdk/blob/main/nodejs/README.md#custom-providers
 *   node_modules/@github/copilot-sdk/dist/types.d.ts (ProviderConfig)
 *
 *   - `type: "openai" | "azure" | "anthropic"`   (default "openai")
 *   - `baseUrl`                                   (required)
 *   - `apiKey?`                                   (optional for local providers)
 *   - `bearerToken?`                              (takes precedence over apiKey)
 *   - `wireApi?: "completions" | "responses"`     (openai/azure only)
 *   - `azure?: { apiVersion?: string }`
 *   - `headers?: Record<string, string>`          (custom HTTP headers — natively supported)
 *   - `maxPromptTokens?` / `maxOutputTokens?`      (accepted by the CLI server even though SDK 0.3.0 types omit them)
 *
 * Returns null when BYO is disabled or has no baseUrl — caller branches on null
 * to decide between SDK BYOK mode and the bundled Copilot model catalog.
 */
export interface SdkProviderConfig {
  type?: ByoLlmProviderType;
  wireApi?: ByoLlmWireApi;
  baseUrl: string;
  apiKey?: string;
  bearerToken?: string;
  azure?: { apiVersion?: string };
  headers?: Record<string, string>;
  maxPromptTokens?: number;
  maxOutputTokens?: number;
}

export function buildProviderConfig(config: ByoLlmConfig | null | undefined): SdkProviderConfig | null {
  if (!config || !config.enabled) return null;
  const baseUrl = config.baseUrl?.trim();
  if (!baseUrl) return null;

  const provider: SdkProviderConfig = {
    type: config.providerType ?? 'openai',
    baseUrl,
  };

  if (config.bearerToken && config.bearerToken.length > 0) {
    provider.bearerToken = config.bearerToken;
  } else if (config.apiKey && config.apiKey.length > 0) {
    provider.apiKey = config.apiKey;
  }

  if (config.wireApi) provider.wireApi = config.wireApi;
  if (provider.type === 'azure' && config.azureApiVersion && config.azureApiVersion.trim().length > 0) {
    provider.azure = { apiVersion: config.azureApiVersion.trim() };
  }

  if (typeof config.maxPromptTokens === 'number' && Number.isFinite(config.maxPromptTokens) && config.maxPromptTokens > 0) {
    provider.maxPromptTokens = config.maxPromptTokens;
  }
  if (typeof config.maxOutputTokens === 'number' && Number.isFinite(config.maxOutputTokens) && config.maxOutputTokens > 0) {
    provider.maxOutputTokens = config.maxOutputTokens;
  }

  if (config.customHeaders && typeof config.customHeaders === 'object') {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(config.customHeaders)) {
      if (typeof v === 'string' && v.length > 0) headers[k] = v;
    }
    if (Object.keys(headers).length > 0) provider.headers = headers;
  }

  return provider;
}
