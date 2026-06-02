// BYO LLM IPC handlers — get/save/probe/disable/restartAgents flow for the
// custom OpenAI-compatible LLM endpoint surface in Settings.

import { ipcMain, BrowserWindow } from 'electron';
import { getErrorMessage } from '@chamber/shared/getErrorMessage';
import { IPC } from '@chamber/shared';
import type { ByoLlmConfig, ByoLlmProbeResult, ByoLlmSaveResult } from '@chamber/shared/types';
import {
  ByoLlmStore,
  Logger,
  MindManager,
  probeEndpoint,
  redactUrlCredentials,
} from '@chamber/services';

const log = Logger.create('ByoLlm');

const MASKED_SECRET = '********';

// Re-exported so existing callers (apps/desktop/src/main.ts) continue to import
// probeEndpoint from this module while the implementation lives in
// @chamber/services. New code should import from '@chamber/services' directly.
export { probeEndpoint };

function broadcast(config: ByoLlmConfig | null): void {
  const rendererConfig = redactConfigForRenderer(config);
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.BYO_LLM.CHANGED, rendererConfig);
  }
}

export interface ByoLlmIpcOptions {
  featureEnabled?: boolean;
  /**
   * Optional callback fired after a successful save/disable so the host can
   * refresh any cached BYO provider config before minds are restarted.
   */
  onConfigChanged?: (config: ByoLlmConfig | null) => void;
}

export function setupByoLlmIPC(
  store: ByoLlmStore,
  mindManager: MindManager,
  options: ByoLlmIpcOptions = {},
): void {
  const featureEnabled = options.featureEnabled ?? true;

  ipcMain.handle(IPC.BYO_LLM.GET, async (): Promise<ByoLlmConfig | null> => {
    if (!featureEnabled) return null;
    return redactConfigForRenderer(await store.load());
  });

  ipcMain.handle(IPC.BYO_LLM.SAVE, async (_event, config: ByoLlmConfig): Promise<ByoLlmSaveResult> => {
    if (!featureEnabled) return featureUnavailableSaveResult();
    try {
      if (!config || typeof config !== 'object') {
        return { success: false, error: 'Invalid config payload' };
      }
      if (config.enabled && (!config.baseUrl || !config.baseUrl.trim())) {
        return { success: false, error: 'Base URL is required when enabling BYO LLM' };
      }
      if (config.enabled && (!config.model || !config.model.trim())) {
        return { success: false, error: 'Default model is required when enabling BYO LLM' };
      }
      const hydratedConfig = await hydrateMaskedSecrets(store, config);
      await store.save(hydratedConfig);
      const savedConfig = await store.load();
      options.onConfigChanged?.(savedConfig);
      broadcast(savedConfig);
      return { success: true };
    } catch (err) {
      const message = getErrorMessage(err);
      log.error('Failed to save BYO LLM config:', message);
      return { success: false, error: message };
    }
  });

  ipcMain.handle(IPC.BYO_LLM.DISABLE, async (): Promise<ByoLlmSaveResult> => {
    if (!featureEnabled) return featureUnavailableSaveResult();
    try {
      await store.clear();
      options.onConfigChanged?.(null);
      broadcast(null);
      return { success: true };
    } catch (err) {
      const message = getErrorMessage(err);
      log.error('Failed to disable BYO LLM config:', message);
      return { success: false, error: message };
    }
  });

  ipcMain.handle(IPC.BYO_LLM.PROBE, async (_event, config: ByoLlmConfig): Promise<ByoLlmProbeResult> => {
    if (!featureEnabled) return { ok: false, error: featureUnavailableMessage() };
    if (!config || !config.baseUrl || !config.baseUrl.trim()) {
      return { ok: false, error: 'Base URL is required' };
    }
    return probeEndpoint(await hydrateMaskedSecrets(store, config));
  });

  ipcMain.handle(IPC.BYO_LLM.RESTART_AGENTS, async (): Promise<{ success: boolean; restartedCount: number; error?: string }> => {
    if (!featureEnabled) return { success: false, restartedCount: 0, error: featureUnavailableMessage() };
    try {
      const config = await store.load();
      const result = await mindManager.restartAllMindsForByoChange(config?.enabled === true ? undefined : null);
      return { success: true, restartedCount: result.restartedCount };
    } catch (err) {
      const message = getErrorMessage(err);
      log.error('Failed to restart agents after BYO change:', message);
      return { success: false, restartedCount: 0, error: message };
    }
  });
}

function featureUnavailableMessage(): string {
  return 'BYO LLM is unavailable in this release channel';
}

function featureUnavailableSaveResult(): ByoLlmSaveResult {
  return { success: false, error: featureUnavailableMessage() };
}

function redactConfigForRenderer(config: ByoLlmConfig | null): ByoLlmConfig | null {
  if (!config) return null;
  const redacted: ByoLlmConfig = { ...config };
  if (redacted.baseUrl) redacted.baseUrl = redactUrlCredentials(redacted.baseUrl);
  if (redacted.apiKey) redacted.apiKey = MASKED_SECRET;
  if (redacted.bearerToken) redacted.bearerToken = MASKED_SECRET;
  if (redacted.customHeaders) {
    redacted.customHeaders = Object.fromEntries(
      Object.entries(redacted.customHeaders).map(([key, value]) => [key, value.length > 0 ? MASKED_SECRET : value]),
    );
  }
  return redacted;
}

async function hydrateMaskedSecrets(store: ByoLlmStore, config: ByoLlmConfig): Promise<ByoLlmConfig> {
  const current = await store.load();
  if (!current) return dropUnresolvedMasks(config);
  const hydrated: ByoLlmConfig = { ...config };
  if (hydrated.apiKey === MASKED_SECRET) {
    if (current.apiKey) hydrated.apiKey = current.apiKey;
    else delete hydrated.apiKey;
  }
  if (hydrated.bearerToken === MASKED_SECRET) {
    if (current.bearerToken) hydrated.bearerToken = current.bearerToken;
    else delete hydrated.bearerToken;
  }
  if (hydrated.customHeaders) {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(hydrated.customHeaders)) {
      if (value === MASKED_SECRET) {
        const currentValue = current.customHeaders?.[key];
        if (currentValue) headers[key] = currentValue;
      } else {
        headers[key] = value;
      }
    }
    hydrated.customHeaders = Object.keys(headers).length > 0 ? headers : undefined;
  }
  return hydrated;
}

function dropUnresolvedMasks(config: ByoLlmConfig): ByoLlmConfig {
  const cleaned: ByoLlmConfig = { ...config };
  if (cleaned.apiKey === MASKED_SECRET) delete cleaned.apiKey;
  if (cleaned.bearerToken === MASKED_SECRET) delete cleaned.bearerToken;
  if (cleaned.customHeaders) {
    const headers = Object.fromEntries(Object.entries(cleaned.customHeaders).filter(([, value]) => value !== MASKED_SECRET));
    cleaned.customHeaders = Object.keys(headers).length > 0 ? headers : undefined;
  }
  return cleaned;
}
