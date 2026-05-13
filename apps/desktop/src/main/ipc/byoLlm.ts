// BYO LLM IPC handlers — get/save/probe/disable/restartAgents flow for the
// custom OpenAI-compatible LLM endpoint surface in Settings.

import { ipcMain, BrowserWindow } from 'electron';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import { IPC } from '@chamber/shared';
import type { ByoLlmConfig, ByoLlmProbeResult, ByoLlmSaveResult } from '@chamber/shared/types';
import { ByoLlmStore, Logger, MindManager } from '@chamber/services';

const log = Logger.create('ByoLlm');

const PROBE_TIMEOUT_MS = 15_000;
const MASKED_SECRET = '********';

function broadcast(config: ByoLlmConfig | null): void {
  const rendererConfig = redactConfigForRenderer(config);
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.BYO_LLM.CHANGED, rendererConfig);
  }
}

export interface ByoLlmIpcOptions {
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
  ipcMain.handle(IPC.BYO_LLM.GET, async (): Promise<ByoLlmConfig | null> => redactConfigForRenderer(await store.load()));

  ipcMain.handle(IPC.BYO_LLM.SAVE, async (_event, config: ByoLlmConfig): Promise<ByoLlmSaveResult> => {
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
      const message = err instanceof Error ? err.message : String(err);
      log.error('Failed to save BYO LLM config:', message);
      return { success: false, error: message };
    }
  });

  ipcMain.handle(IPC.BYO_LLM.DISABLE, async (): Promise<ByoLlmSaveResult> => {
    try {
      await store.clear();
      options.onConfigChanged?.(null);
      broadcast(null);
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error('Failed to disable BYO LLM config:', message);
      return { success: false, error: message };
    }
  });

  ipcMain.handle(IPC.BYO_LLM.PROBE, async (_event, config: ByoLlmConfig): Promise<ByoLlmProbeResult> => {
    if (!config || !config.baseUrl || !config.baseUrl.trim()) {
      return { ok: false, error: 'Base URL is required' };
    }
    return probeEndpoint(await hydrateMaskedSecrets(store, config));
  });

  ipcMain.handle(IPC.BYO_LLM.RESTART_AGENTS, async (): Promise<{ success: boolean; restartedCount: number; error?: string }> => {
    try {
      const config = await store.load();
      const result = await mindManager.restartAllMindsForByoChange(config?.enabled === true ? undefined : null);
      return { success: true, restartedCount: result.restartedCount };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error('Failed to restart agents after BYO change:', message);
      return { success: false, restartedCount: 0, error: message };
    }
  });
}

/**
 * Probe a BYO LLM endpoint by hitting `<baseUrl>/models` and parsing the
 * OpenAI-compatible response. Used by Settings before save to confirm
 * connectivity + give the user a model count + populate the model dropdown.
 *
 * Exported for unit testability; in production it's invoked by the IPC handler.
 */
export async function probeEndpoint(config: ByoLlmConfig): Promise<ByoLlmProbeResult> {
  try {
    const modelsUrl = new URL(joinUrl(config.baseUrl, 'models'));
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'Chamber-BYO-Probe/1.0',
    };
    if (config.bearerToken) {
      headers.Authorization = `Bearer ${config.bearerToken}`;
    } else if (config.apiKey) {
      headers.Authorization = `Bearer ${config.apiKey}`;
    }
    if (config.customHeaders) {
      for (const [k, v] of Object.entries(config.customHeaders)) {
        headers[k] = v;
      }
    }

    const { statusCode, body } = await httpRequest(modelsUrl, headers);

    if (!statusCode || statusCode < 200 || statusCode >= 300) {
      return {
        ok: false,
        status: statusCode,
        error: `Endpoint returned HTTP ${statusCode ?? 'unknown'}: ${redactSecrets(truncate(body, 200), config)}`,
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return { ok: false, status: statusCode, error: 'Endpoint returned non-JSON response' };
    }

    const models = extractModels(parsed);
    if (models.length === 0) {
      return { ok: false, status: statusCode, error: 'Endpoint returned no models in /models response' };
    }

    return { ok: true, modelCount: models.length, models };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: redactSecrets(message, config) };
  }
}

function joinUrl(base: string, path: string): string {
  const trimmedBase = base.trim().replace(/\/+$/, '');
  const trimmedPath = path.replace(/^\/+/, '');
  return `${trimmedBase}/${trimmedPath}`;
}

function extractModels(parsed: unknown): Array<{ id: string; name?: string }> {
  if (!parsed || typeof parsed !== 'object') return [];
  const data = (parsed as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  const models: Array<{ id: string; name?: string }> = [];
  for (const item of data) {
    if (item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string') {
      const id = (item as { id: string }).id;
      const name = typeof (item as { name?: unknown }).name === 'string' ? (item as { name: string }).name : undefined;
      models.push(name ? { id, name } : { id });
    }
  }
  return models;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

function redactSecrets(value: string, config: ByoLlmConfig): string {
  let redacted = value;
  const customHeaderSecrets = config.customHeaders ? Object.values(config.customHeaders) : [];
  for (const secret of [config.apiKey, config.bearerToken, ...customHeaderSecrets]) {
    if (secret && secret.length > 0) {
      redacted = redacted.split(secret).join('<redacted>');
    }
  }
  return redacted;
}

function redactConfigForRenderer(config: ByoLlmConfig | null): ByoLlmConfig | null {
  if (!config) return null;
  const redacted: ByoLlmConfig = { ...config };
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

function httpRequest(url: URL, headers: Record<string, string>): Promise<{ statusCode?: number; body: string }> {
  return new Promise((resolve, reject) => {
    const lib: typeof https | typeof http = url.protocol === 'http:' ? http : https;
    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'http:' ? 80 : 443),
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk: string) => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({ statusCode: res.statusCode, body });
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(PROBE_TIMEOUT_MS, () => {
      req.destroy(new Error(`Probe timed out after ${PROBE_TIMEOUT_MS}ms`));
    });
    req.end();
  });
}
