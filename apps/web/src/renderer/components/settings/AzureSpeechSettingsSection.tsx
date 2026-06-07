import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import type { AzureSpeechConfig } from '@chamber/shared/types';
import { cn } from '../../lib/utils';

interface TestState {
  status: 'idle' | 'testing' | 'success' | 'error';
  error?: string;
}

const EMPTY_FORM: AzureSpeechConfig = {
  enabled: false,
  region: '',
  sttLanguage: '',
  ttsVoice: '',
  apiKey: '',
};

/**
 * Settings -> "Voice" section.
 *
 * Configures Azure AI Speech for dictation (speech-to-text) and spoken
 * replies (text-to-speech). The subscription key is stored in the OS keychain
 * by the main process; the renderer only ever sees a masked value and
 * short-lived authorization tokens minted on demand.
 */
export function AzureSpeechSettingsSection() {
  const [savedConfig, setSavedConfig] = useState<AzureSpeechConfig | null>(null);
  const [form, setForm] = useState<AzureSpeechConfig>(EMPTY_FORM);
  const [test, setTest] = useState<TestState>({ status: 'idle' });
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void window.electronAPI.azureSpeech.get().then((config) => {
      if (cancelled) return;
      if (config) {
        setSavedConfig(config);
        setForm({ ...EMPTY_FORM, ...config });
      }
    });
    const unsub = window.electronAPI.azureSpeech.onChanged((config) => {
      setSavedConfig(config ?? null);
      if (config) {
        setForm({ ...EMPTY_FORM, ...config });
      } else {
        setForm(EMPTY_FORM);
        setTest({ status: 'idle' });
      }
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  const isEnabled = savedConfig?.enabled === true;

  const updateForm = <K extends keyof AzureSpeechConfig>(key: K, value: AzureSpeechConfig[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (test.status !== 'idle') setTest({ status: 'idle' });
  };

  const handleTest = async () => {
    setTest({ status: 'testing' });
    setStatusMessage(null);
    const result = await window.electronAPI.azureSpeech.test(form);
    if (result.ok) {
      setTest({ status: 'success' });
    } else {
      setTest({ status: 'error', error: result.error });
    }
  };

  const handleApply = async () => {
    setApplying(true);
    setStatusMessage(null);
    try {
      if (form.enabled) {
        if (!form.region.trim()) {
          setStatusMessage('Region is required to enable voice.');
          return;
        }
        const result = await window.electronAPI.azureSpeech.save(form);
        setStatusMessage(result.success ? 'Voice settings applied.' : (result.error ?? 'Failed to save voice settings.'));
      } else {
        const result = await window.electronAPI.azureSpeech.disable();
        setStatusMessage(result.success ? 'Voice disabled.' : (result.error ?? 'Failed to disable voice.'));
      }
    } finally {
      setApplying(false);
    }
  };

  const showActions = form.enabled || isEnabled;
  const canApply = form.enabled ? Boolean(form.region.trim()) : isEnabled;

  return (
    <section>
      <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">
        Voice
      </h2>
      <div className="rounded-lg border border-border bg-card p-4 space-y-4">
        <p className="text-sm text-muted-foreground">
          Use Azure AI Speech for dictation (speech-to-text) and spoken replies (text-to-speech).
          Provide your Speech resource region and subscription key. Your key is stored securely in the
          OS keychain and never leaves your machine except to authenticate directly with Azure.
        </p>

        {isEnabled ? (
          <p role="status" className="text-sm text-foreground">
            Active in region <span className="font-mono">{savedConfig?.region}</span>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Currently disabled.</p>
        )}

        <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-background/40 p-3">
          <div>
            <p className="text-sm font-medium text-foreground">Enable voice</p>
            <p className="text-xs text-muted-foreground">
              Turn this on to reveal Azure Speech settings and add the microphone to chat.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={form.enabled}
            aria-label="Enable voice"
            aria-controls="azure-speech-config-fields"
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
          <div id="azure-speech-config-fields" className="space-y-3">
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">Region</span>
              <input
                type="text"
                value={form.region}
                onChange={(e) => updateForm('region', e.target.value)}
                placeholder="e.g. eastus"
                aria-label="Region"
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:border-muted-foreground"
              />
            </label>

            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">Subscription key</span>
              <input
                type="password"
                value={form.apiKey ?? ''}
                onChange={(e) => updateForm('apiKey', e.target.value)}
                placeholder="Azure Speech subscription key"
                aria-label="Subscription key"
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:border-muted-foreground"
              />
            </label>

            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">Recognition language (optional)</span>
              <input
                type="text"
                value={form.sttLanguage ?? ''}
                onChange={(e) => updateForm('sttLanguage', e.target.value)}
                placeholder="e.g. en-US"
                aria-label="Recognition language"
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:border-muted-foreground"
              />
            </label>

            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">Voice (optional)</span>
              <input
                type="text"
                value={form.ttsVoice ?? ''}
                onChange={(e) => updateForm('ttsVoice', e.target.value)}
                placeholder="e.g. en-US-AvaNeural"
                aria-label="Voice"
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:border-muted-foreground"
              />
            </label>
          </div>
        ) : (
          <div id="azure-speech-config-fields" className="rounded-lg border border-dashed border-border bg-background/30 p-3 text-sm text-muted-foreground">
            Voice fields are hidden while the toggle is off.
          </div>
        )}

        {showActions ? (
          <div className="flex flex-wrap items-center gap-2">
            {form.enabled ? (
              <button
                type="button"
                onClick={() => { void handleTest(); }}
                disabled={!form.region.trim() || test.status === 'testing'}
                className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent transition-colors disabled:opacity-50"
              >
                {test.status === 'testing' ? 'Testing…' : 'Test connection'}
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

        {test.status === 'success' ? (
          <p role="status" className="flex items-center gap-1.5 text-sm text-genesis">
            <Check className="h-4 w-4" />
            Connection succeeded
          </p>
        ) : null}
        {test.status === 'error' ? (
          <p role="alert" className="text-sm text-destructive">{test.error ?? 'Connection failed.'}</p>
        ) : null}
        {statusMessage ? (
          <p role="status" className="text-sm text-muted-foreground">{statusMessage}</p>
        ) : null}
      </div>
    </section>
  );
}
