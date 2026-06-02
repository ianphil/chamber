import React, { useEffect, useState } from 'react';
import { getErrorMessage } from '@chamber/shared/getErrorMessage';
import type { ByoLlmConfig, ByoLlmProbeResult } from '@chamber/shared/types';
import { cn } from '../../lib/utils';

interface ProbeState {
  status: 'idle' | 'probing' | 'success' | 'error';
  result?: ByoLlmProbeResult;
}

const EMPTY_FORM: ByoLlmConfig = {
  enabled: false,
  baseUrl: '',
  providerType: 'openai',
  apiKey: '',
  model: '',
};

function probeConfigKey(config: ByoLlmConfig, headersText: string): string {
  return JSON.stringify({
    baseUrl: config.baseUrl.trim(),
    providerType: config.providerType ?? 'openai',
    apiKey: config.apiKey ?? '',
    bearerToken: config.bearerToken ?? '',
    wireApi: config.wireApi ?? '',
    azureApiVersion: config.azureApiVersion ?? '',
    headersText: headersText.trim(),
  });
}

function parseOptionalPositiveNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Settings → "Local & Custom LLM" section.
 *
 * Lets the user point Chamber's underlying GitHub Copilot CLI runtime at a
 * custom OpenAI-compatible endpoint (LM Studio, Ollama, vLLM, Foundry Local,
 * Azure OpenAI, etc.) via the CLI's native BYOK env vars
 * (COPILOT_PROVIDER_BASE_URL etc).
 *
 * Flow:
   *   1. User toggles On
   *   2. Fills Endpoint URL / API key / model / optional headers
   *   3. Clicks "Test connection" → probe hits the endpoint's /models
   *   4. On success, "Apply" enables BYO models and refreshes only BYO-selected agents
   *   5. Toggle Off + Apply clears BYO models and leaves cloud-selected agents alone
   */
export function LocalLlmSettingsSection() {
  const [savedConfig, setSavedConfig] = useState<ByoLlmConfig | null>(null);
  const [form, setForm] = useState<ByoLlmConfig>(EMPTY_FORM);
  const [probe, setProbe] = useState<ProbeState>({ status: 'idle' });
  const [probedModels, setProbedModels] = useState<Array<{ id: string; name?: string }>>([]);
  const [probedConfigKey, setProbedConfigKey] = useState<string | null>(null);
  const [headersText, setHeadersText] = useState('');
  const [headersError, setHeadersError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void window.electronAPI.byoLlm.get().then((config) => {
      if (cancelled) return;
      if (config) {
        setSavedConfig(config);
        setForm(config);
        if (config.customHeaders && Object.keys(config.customHeaders).length > 0) {
          setHeadersText(JSON.stringify(config.customHeaders, null, 2));
        }
      }
    });
    const unsub = window.electronAPI.byoLlm.onChanged((config) => {
      setSavedConfig(config ?? null);
      if (config) {
        setForm(config);
        if (config.customHeaders && Object.keys(config.customHeaders).length > 0) {
          setHeadersText(JSON.stringify(config.customHeaders, null, 2));
        } else {
          setHeadersText('');
        }
      } else {
        setForm(EMPTY_FORM);
        setHeadersText('');
        setProbe({ status: 'idle' });
        setProbedModels([]);
        setProbedConfigKey(null);
      }
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  const isEnabled = savedConfig?.enabled === true;
  const currentProbeKey = probeConfigKey(form, headersText);
  const modelOptions = probedConfigKey === currentProbeKey ? probedModels : [];
  const probeOk = probe.status === 'success'
    && probe.result?.ok === true
    && probedConfigKey === currentProbeKey;

  const parseHeaders = (): { headers?: Record<string, string>; error: string | null } => {
    if (!headersText.trim()) return { headers: undefined, error: null };
    try {
      const parsed = JSON.parse(headersText) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { error: 'Custom headers must be a JSON object of string-to-string pairs.' };
      }
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v !== 'string') {
          return { error: `Header value for "${k}" must be a string.` };
        }
        headers[k] = v;
      }
      return { headers, error: null };
    } catch (err) {
      return { error: `Invalid JSON: ${getErrorMessage(err)}` };
    }
  };

  const buildConfigForSubmit = (): ByoLlmConfig | null => {
    const { headers, error } = parseHeaders();
    if (error) {
      setHeadersError(error);
      return null;
    }
    setHeadersError(null);
    return {
      ...form,
      enabled: true,
      customHeaders: headers,
    };
  };

  const handleProbe = async () => {
    const cfg = buildConfigForSubmit();
    if (!cfg) return;
    setProbe({ status: 'probing' });
    setStatusMessage(null);
    const result = await window.electronAPI.byoLlm.probe(cfg);
    const key = probeConfigKey(cfg, headersText);
    setProbe({ status: result.ok ? 'success' : 'error', result });
    if (result.ok) {
      setProbedModels(result.models);
      setProbedConfigKey(key);
    } else {
      setProbedModels([]);
      setProbedConfigKey(null);
    }
    if (result.ok && result.modelCount > 0 && !cfg.model && result.models[0]) {
      setForm((prev) => ({ ...prev, model: result.models[0].id }));
    }
  };

  const handleApply = async () => {
    setApplying(true);
    setStatusMessage(null);
    try {
      if (form.enabled) {
        const cfg = buildConfigForSubmit();
        if (!cfg) return;
        const saveResult = await window.electronAPI.byoLlm.save(cfg);
        if (!saveResult.success) {
          setStatusMessage(saveResult.error ?? 'Failed to save BYO LLM config.');
          return;
        }
        const restartResult = await window.electronAPI.byoLlm.restartAgents();
        setStatusMessage(
          restartResult.success
            ? `BYO LLM settings applied. Refreshed ${restartResult.restartedCount} BYO-selected agent(s).`
            : `Saved, but agent refresh failed: ${restartResult.error ?? 'unknown error'}`,
        );
      } else {
        const result = await window.electronAPI.byoLlm.disable();
        if (!result.success) {
          setStatusMessage(result.error ?? 'Failed to disable BYO LLM.');
          return;
        }
        const restartResult = await window.electronAPI.byoLlm.restartAgents();
        setStatusMessage(
          restartResult.success
            ? `BYO LLM disabled. Refreshed ${restartResult.restartedCount} BYO-selected agent(s).`
            : `Disabled, but agent refresh failed: ${restartResult.error ?? 'unknown error'}`,
        );
      }
    } finally {
      setApplying(false);
    }
  };

  const updateForm = <K extends keyof ByoLlmConfig>(key: K, value: ByoLlmConfig[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (key !== 'model' && probe.status !== 'idle') {
      setProbe({ status: 'idle' });
    }
  };

  const updateHeadersText = (value: string) => {
    setHeadersText(value);
    if (probe.status !== 'idle') {
      setProbe({ status: 'idle' });
    }
  };

  const canApply = form.enabled ? probeOk : isEnabled;
  const showActions = form.enabled || isEnabled;

  return (
    <section>
      <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">
        Local &amp; Custom LLM
      </h2>
      <div className="rounded-lg border border-border bg-card p-4 space-y-4">
        <p className="text-sm text-muted-foreground">
          Point Chamber at a local/custom provider endpoint (LM Studio, Ollama, vLLM, Foundry Local, Azure OpenAI, Anthropic).
          Models from the endpoint will appear in the chat model picker.
          Tool support depends on the chosen model — small models (&lt;8B) may struggle with complex tool calls.
        </p>

        {isEnabled ? (
          <p role="status" className="text-sm text-foreground">
            Active: <span className="font-mono">{savedConfig?.model ?? '(default)'}</span> @{' '}
            <span className="font-mono">{savedConfig?.baseUrl}</span>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Currently disabled. Default GitHub Copilot models in use.</p>
        )}

        <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-background/40 p-3">
          <div>
            <p className="text-sm font-medium text-foreground">Enable BYO LLM models</p>
            <p className="text-xs text-muted-foreground">
              Turn this on to reveal endpoint settings and add local/custom models to chat.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={form.enabled}
            aria-label="Enable BYO LLM"
            aria-controls="byo-llm-config-fields"
            onClick={() => updateForm('enabled', !form.enabled)}
            className={cn(
              'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-border transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background',
              form.enabled ? 'bg-primary' : 'bg-muted',
            )}
          >
            <span
              className={cn(
                'inline-block h-5 w-5 rounded-full bg-background shadow transition-transform',
                form.enabled ? 'translate-x-5' : 'translate-x-0.5',
              )}
            />
          </button>
        </div>

        {form.enabled ? (
          <div id="byo-llm-config-fields" className="space-y-3">
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">Endpoint URL</span>
              <input
                type="url"
                value={form.baseUrl}
                onChange={(e) => updateForm('baseUrl', e.target.value)}
                placeholder="https://example.com/v1"
                aria-label="Endpoint URL"
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:border-muted-foreground"
              />
            </label>

            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">Provider type</span>
              <select
                value={form.providerType ?? 'openai'}
                onChange={(e) => updateForm('providerType', e.target.value as ByoLlmConfig['providerType'])}
                aria-label="Provider type"
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-muted-foreground"
              >
                <option value="openai">OpenAI-compatible (default)</option>
                <option value="azure">Azure OpenAI</option>
                <option value="anthropic">Anthropic</option>
              </select>
            </label>

            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">API key (optional for local providers)</span>
              <input
                type="password"
                value={form.apiKey ?? ''}
                onChange={(e) => updateForm('apiKey', e.target.value)}
                placeholder="lm-studio"
                aria-label="API key"
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:border-muted-foreground"
              />
            </label>

            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">Bearer token (optional, overrides API key)</span>
              <input
                type="password"
                value={form.bearerToken ?? ''}
                onChange={(e) => updateForm('bearerToken', e.target.value)}
                placeholder="Bearer token"
                aria-label="Bearer token"
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:border-muted-foreground"
              />
            </label>

            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">Default model</span>
              {modelOptions.length > 0 ? (
                <select
                  value={form.model ?? ''}
                  onChange={(e) => updateForm('model', e.target.value)}
                  aria-label="Default model"
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:border-muted-foreground"
                >
                  <option value="">— Select a model —</option>
                  {modelOptions.map((m) => (
                    <option key={m.id} value={m.id}>{m.id}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={form.model ?? ''}
                  onChange={(e) => updateForm('model', e.target.value)}
                  placeholder="e.g. qwen/qwen3.5-9b"
                  aria-label="Default model"
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:border-muted-foreground"
                />
              )}
            </label>

            <details className="block">
              <summary className="text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground">
                Advanced provider settings
              </summary>
              <div className="mt-2 space-y-3">
                <label className="block">
                  <span className="text-xs font-medium text-muted-foreground">Wire API</span>
                  <select
                    value={form.wireApi ?? ''}
                    onChange={(e) => updateForm('wireApi', (e.target.value || undefined) as ByoLlmConfig['wireApi'])}
                    aria-label="Wire API"
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-muted-foreground"
                  >
                    <option value="">Provider default</option>
                    <option value="completions">Chat completions</option>
                    <option value="responses">Responses</option>
                  </select>
                </label>

                {form.providerType === 'azure' ? (
                  <label className="block">
                    <span className="text-xs font-medium text-muted-foreground">Azure API version (optional)</span>
                    <input
                      type="text"
                      value={form.azureApiVersion ?? ''}
                      onChange={(e) => updateForm('azureApiVersion', e.target.value)}
                      placeholder="e.g. 2024-10-21"
                      aria-label="Azure API version"
                      className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:border-muted-foreground"
                    />
                  </label>
                ) : null}

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="block">
                    <span className="text-xs font-medium text-muted-foreground">Max prompt tokens (optional)</span>
                    <input
                      type="number"
                      min={1}
                      value={form.maxPromptTokens ?? ''}
                      onChange={(e) => updateForm('maxPromptTokens', parseOptionalPositiveNumber(e.target.value))}
                      placeholder="e.g. 131072"
                      aria-label="Max prompt tokens"
                      className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:border-muted-foreground"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-muted-foreground">Max output tokens (optional)</span>
                    <input
                      type="number"
                      min={1}
                      value={form.maxOutputTokens ?? ''}
                      onChange={(e) => updateForm('maxOutputTokens', parseOptionalPositiveNumber(e.target.value))}
                      placeholder="e.g. 4096"
                      aria-label="Max output tokens"
                      className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:border-muted-foreground"
                    />
                  </label>
                </div>

                <p className="text-xs text-muted-foreground">
                  Azure users can set the deployment name as the wire model. Anthropic and proxy-specific headers can be supplied below.
                </p>

              <textarea
                value={headersText}
                onChange={(e) => updateHeadersText(e.target.value)}
                placeholder='{ "X-Custom-Header": "value" }'
                aria-label="Custom headers JSON"
                rows={4}
                className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:border-muted-foreground"
              />
              {headersError ? (
                <p role="alert" className="mt-1 text-xs text-destructive">{headersError}</p>
              ) : null}
              </div>
            </details>
          </div>
        ) : (
          <div id="byo-llm-config-fields" className="rounded-lg border border-dashed border-border bg-background/30 p-3 text-sm text-muted-foreground">
            BYO fields are hidden while the toggle is off. GitHub Copilot cloud models remain available.
          </div>
        )}

        {showActions ? (
          <div className="flex flex-wrap items-center gap-2">
            {form.enabled ? (
              <button
                type="button"
                onClick={() => { void handleProbe(); }}
                disabled={!form.baseUrl || probe.status === 'probing'}
                className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent transition-colors disabled:opacity-50"
              >
                {probe.status === 'probing' ? 'Testing…' : 'Test connection'}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => { void handleApply(); }}
              disabled={!canApply || applying}
              className="rounded-lg border border-border bg-primary text-primary-foreground px-3 py-2 text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {applying ? 'Applying…' : 'Apply'}
            </button>
          </div>
        ) : null}

        {probe.status === 'success' && probe.result?.ok ? (
          <p role="status" className="text-sm text-green-500">
            ✓ Found {probe.result.modelCount} model{probe.result.modelCount === 1 ? '' : 's'}
          </p>
        ) : null}
        {probe.status === 'error' && probe.result && !probe.result.ok ? (
          <p role="alert" className="text-sm text-destructive">{probe.result.error}</p>
        ) : null}
        {statusMessage ? (
          <p role="status" className="text-sm text-muted-foreground">{statusMessage}</p>
        ) : null}
      </div>
    </section>
  );
}
