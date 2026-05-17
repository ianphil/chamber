// byoLlmModelsProvider — async source of BYO LLM models for ChatService.listModels.
//
// When BYO is enabled, ChatService merges these into the model picker alongside
// the Copilot SDK's official catalog. The provider must be resilient to probe
// failure: if the endpoint is unreachable, we must still surface the user's
// *saved* BYO model so the renderer keeps it as the selected model. Otherwise
// helpers.ts:selectedModelForActiveMind silently falls back to the first cloud
// model and BYO-routed minds quietly send traffic to GitHub Copilot — a
// regression of the user's explicit choice.

import type { ByoLlmConfig, ByoLlmProbeResult, ModelInfo } from '@chamber/shared/types';

export interface ByoLlmModelsProviderDeps {
  /** Returns the current BYO config (e.g. from the in-memory cache). Null when never loaded. */
  getConfig(): ByoLlmConfig | null;
  /** Probe implementation. Defaults to the live HTTP probe in production. */
  probe: (config: ByoLlmConfig) => Promise<ByoLlmProbeResult>;
  /** Optional structured-error sink for the probe-failed branch. */
  onProbeError?: (err: unknown, config: ByoLlmConfig) => void;
}

export function createByoLlmModelsProvider(
  deps: ByoLlmModelsProviderDeps,
): () => Promise<ModelInfo[] | null> {
  return async () => {
    const config = deps.getConfig();
    if (!config?.enabled || !config.baseUrl) return null;

    let result: ByoLlmProbeResult;
    try {
      result = await deps.probe(config);
    } catch (err) {
      deps.onProbeError?.(err, config);
      return savedModelFallback(config);
    }

    if (!result.ok || !result.models) {
      const reason = !result.ok ? result.error : 'BYO LLM probe returned no models';
      deps.onProbeError?.(new Error(reason ?? 'BYO LLM probe failed'), config);
      return savedModelFallback(config);
    }

    return result.models.map((m) => ({ id: m.id, name: m.name ?? m.id, provider: 'byo' as const }));
  };
}

/**
 * When the probe fails, return a single-entry list containing the user's
 * saved BYO model (if any) so the renderer keeps that model selected. The
 * upcoming chat turn will surface a real error from the SDK rather than
 * silently being re-routed to a cloud model.
 *
 * If the user has no saved model, we still return [] (not null) so the
 * downstream selection doesn't fall back to cloud — but listModels() in
 * ChatService will then proceed with SDK-only results, which is the
 * pre-existing behaviour for a freshly-enabled BYO config.
 */
function savedModelFallback(config: ByoLlmConfig): ModelInfo[] {
  if (!config.model) return [];
  return [{
    id: config.model,
    name: config.model,
    provider: 'byo' as const,
  }];
}
