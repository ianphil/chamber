import type { ByoLlmConfig } from '@chamber/shared/types';

/**
 * Map a {@link ByoLlmConfig} to the GitHub Copilot CLI environment variables that
 * activate Bring-Your-Own-Key (BYOK) mode for a custom OpenAI-compatible endpoint.
 *
 * The variable names and semantics are derived from the GitHub Copilot CLI's own
 * `providers` help text (see `app.js` BYOK section, surfaced via `copilot --help`):
 *
 *   COPILOT_PROVIDER_BASE_URL          (required to activate BYOK)
 *   COPILOT_PROVIDER_TYPE              "openai" (default), "azure", or "anthropic"
 *   COPILOT_PROVIDER_API_KEY           (optional for local providers like Ollama)
 *   COPILOT_PROVIDER_BEARER_TOKEN      (takes precedence over API key)
 *   COPILOT_PROVIDER_WIRE_API          "completions" (default) or "responses"
 *   COPILOT_MODEL                      Model name (sets both ID and wire model)
 *   COPILOT_PROVIDER_MODEL_ID          Well-known model ID for token limits
 *   COPILOT_PROVIDER_WIRE_MODEL        Model name sent to provider API
 *   COPILOT_PROVIDER_MAX_PROMPT_TOKENS
 *   COPILOT_PROVIDER_MAX_OUTPUT_TOKENS
 *
 * Returns an empty object when the config is null, undefined, disabled, or has no
 * baseUrl — callers can spread the result unconditionally onto an env dict.
 */
export function buildByoLlmEnv(config: ByoLlmConfig | null | undefined): Record<string, string> {
  if (!config || !config.enabled) return {};
  if (!config.baseUrl || !config.baseUrl.trim()) return {};

  const env: Record<string, string> = {
    COPILOT_PROVIDER_BASE_URL: config.baseUrl.trim(),
    COPILOT_PROVIDER_TYPE: config.providerType ?? 'openai',
  };

  // Bearer token takes precedence per the CLI's documented semantics.
  if (config.bearerToken && config.bearerToken.length > 0) {
    env.COPILOT_PROVIDER_BEARER_TOKEN = config.bearerToken;
  } else if (config.apiKey && config.apiKey.length > 0) {
    env.COPILOT_PROVIDER_API_KEY = config.apiKey;
  }

  if (config.wireApi) env.COPILOT_PROVIDER_WIRE_API = config.wireApi;

  if (config.model) env.COPILOT_MODEL = config.model;
  if (config.modelId) env.COPILOT_PROVIDER_MODEL_ID = config.modelId;
  if (config.wireModel) env.COPILOT_PROVIDER_WIRE_MODEL = config.wireModel;

  if (typeof config.maxPromptTokens === 'number' && config.maxPromptTokens > 0) {
    env.COPILOT_PROVIDER_MAX_PROMPT_TOKENS = String(config.maxPromptTokens);
  }
  if (typeof config.maxOutputTokens === 'number' && config.maxOutputTokens > 0) {
    env.COPILOT_PROVIDER_MAX_OUTPUT_TOKENS = String(config.maxOutputTokens);
  }

  return env;
}
