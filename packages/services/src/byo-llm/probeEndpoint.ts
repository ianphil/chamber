// probeEndpoint — connectivity + model-listing probe for a BYO LLM endpoint.
//
// Hits `<baseUrl>/models` and parses the OpenAI-compatible response. Used
// before save to confirm reachability + give the user a model count + populate
// the model dropdown, and at runtime by the desktop's byoLlmModelsProvider.
//
// This module deliberately lives in @chamber/services (not in the IPC adapter)
// so it can be reused by main-process composition and unit-tested without an
// Electron context. The IPC adapter remains a thin wrapper.

import * as http from 'node:http';
import * as https from 'node:https';

import type { ByoLlmConfig, ByoLlmProbeResult } from '@chamber/shared/types';

const DEFAULT_PROBE_TIMEOUT_MS = 15_000;

export interface ProbeEndpointOptions {
  /** Override the probe timeout. Defaults to 15 seconds. */
  timeoutMs?: number;
}

export async function probeEndpoint(
  config: ByoLlmConfig,
  options: ProbeEndpointOptions = {},
): Promise<ByoLlmProbeResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
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

    const { statusCode, body, location } = await httpRequest(modelsUrl, headers, timeoutMs);

    // SSRF defense-in-depth: refuse redirects rather than silently following them
    // (Node's http.request does not follow redirects today, but we make that
    // assumption explicit so a future change or proxy can't surprise us into
    // chasing 302 → 169.254.169.254 or other internal targets).
    if (statusCode && statusCode >= 300 && statusCode < 400) {
      return {
        ok: false,
        status: statusCode,
        error: `Endpoint returned HTTP ${statusCode} redirect${location ? ` to ${redactSecrets(truncate(location, 200), config)}` : ''}; redirects are not followed.`,
      };
    }

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

function joinUrl(base: string, segment: string): string {
  const trimmedBase = base.trim().replace(/\/+$/, '');
  const trimmedSegment = segment.replace(/^\/+/, '');
  return `${trimmedBase}/${trimmedSegment}`;
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

function httpRequest(
  url: URL,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<{ statusCode?: number; body: string; location?: string }> {
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
          const loc = res.headers.location;
          resolve({
            statusCode: res.statusCode,
            body,
            location: typeof loc === 'string' ? loc : undefined,
          });
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Probe timed out after ${timeoutMs}ms`));
    });
    req.end();
  });
}
