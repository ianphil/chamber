import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { getErrorMessage } from '@chamber/shared/getErrorMessage';
import {
  VOICE_DICTATION_MODEL_ID,
  type VoiceDictationConfig,
  type VoiceMicTestResult,
  type VoiceModelStatus,
  type VoicePermissionState,
} from '@chamber/shared/voice-types';
import { cn } from '../../lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';

const SYSTEM_DEFAULT_DEVICE_VALUE = '__system-default__';
const DEFAULT_SHORTCUT = 'Alt+Shift+V';

const DEFAULT_CONFIG: VoiceDictationConfig = {
  enabled: true,
  inputDeviceId: null,
  shortcut: DEFAULT_SHORTCUT,
  pushToTalk: true,
  model: { id: VOICE_DICTATION_MODEL_ID },
};

interface AudioInputDevice {
  readonly deviceId: string;
  readonly label: string;
}

type MicTestState =
  | { readonly status: 'idle' }
  | { readonly status: 'testing' }
  | { readonly status: 'success'; readonly result: Extract<VoiceMicTestResult, { success: true }> }
  | { readonly status: 'error'; readonly message: string };

function normalizeConfig(config: VoiceDictationConfig | null): VoiceDictationConfig {
  if (!config) return DEFAULT_CONFIG;
  return {
    ...DEFAULT_CONFIG,
    ...config,
    inputDeviceId: config.inputDeviceId ?? null,
    shortcut: config.shortcut || DEFAULT_SHORTCUT,
    model: {
      ...DEFAULT_CONFIG.model,
      ...config.model,
    },
  };
}

async function enumerateAudioInputDevices(): Promise<AudioInputDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((device) => device.kind === 'audioinput')
    .map((device, index) => ({
      deviceId: device.deviceId,
      label: device.label || `Microphone ${index + 1}`,
    }))
    .filter((device) => device.deviceId.length > 0);
}

function SettingsRow({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
}) {
  return (
    <div
      data-testid="voice-dictation-settings-row"
      className="flex flex-col gap-3 rounded-lg border border-border bg-background/40 p-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
        {children}
      </div>
    </div>
  );
}

function ToggleSwitch({
  checked,
  label,
  onToggle,
}: {
  readonly checked: boolean;
  readonly label: string;
  readonly onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onToggle}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-border transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background',
        checked ? 'bg-primary' : 'bg-muted',
      )}
    >
      <span
        className={cn(
          'inline-block h-5 w-5 rounded-full bg-background shadow transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

function StatusPill({
  tone,
  children,
}: {
  readonly tone: 'neutral' | 'success' | 'warning' | 'error';
  readonly children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        tone === 'neutral' ? 'border-border bg-muted text-muted-foreground' : null,
        tone === 'success' ? 'border-green-500/30 bg-green-500/10 text-green-500' : null,
        tone === 'warning' ? 'border-yellow-500/30 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400' : null,
        tone === 'error' ? 'border-destructive/30 bg-destructive/10 text-destructive' : null,
      )}
    >
      {children}
    </span>
  );
}

function permissionLabel(state: VoicePermissionState | null): string {
  switch (state) {
    case 'granted':
      return 'Granted';
    case 'denied':
      return 'Denied';
    case 'not-determined':
      return 'Not determined';
    case 'restricted':
      return 'Restricted';
    case 'unsupported':
      return 'Unsupported';
    default:
      return 'Loading…';
  }
}

function permissionTone(state: VoicePermissionState | null): 'neutral' | 'success' | 'warning' | 'error' {
  switch (state) {
    case 'granted':
      return 'success';
    case 'denied':
    case 'restricted':
      return 'error';
    case 'not-determined':
      return 'warning';
    default:
      return 'neutral';
  }
}

function getDownloadProgressPercent(status: VoiceModelStatus | null): number | null {
  if (!status || typeof status.percent !== 'number' || !Number.isFinite(status.percent)) return null;
  return Math.max(0, Math.min(100, Math.round(status.percent)));
}

function modelStatusLabel(status: VoiceModelStatus | null): string {
  if (!status) return 'Loading…';
  if (status.status === 'not-downloaded') return 'Not downloaded';
  if (status.status === 'ready') return 'Ready';
  if (status.status === 'error') return 'Error';
  const progress = getDownloadProgressPercent(status);
  return progress === null ? 'Downloading' : `Downloading ${progress}%`;
}

function modelStatusTone(status: VoiceModelStatus | null): 'neutral' | 'success' | 'warning' | 'error' {
  if (!status || status.status === 'not-downloaded') return 'neutral';
  if (status.status === 'ready') return 'success';
  if (status.status === 'error') return 'error';
  return 'warning';
}

function modelActionLabel(status: VoiceModelStatus | null): string {
  if (status?.status === 'downloading') return 'Cancel';
  if (status?.status === 'ready' || status?.status === 'error') return 'Redownload';
  return 'Download';
}

function formatBytes(bytes: number | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return 'Size unavailable';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

export function VoiceDictationSettingsSection() {
  const [config, setConfig] = useState<VoiceDictationConfig>(DEFAULT_CONFIG);
  const [audioInputDevices, setAudioInputDevices] = useState<AudioInputDevice[]>([]);
  const [permissionState, setPermissionState] = useState<VoicePermissionState | null>(null);
  const [micTest, setMicTest] = useState<MicTestState>({ status: 'idle' });
  const [modelStatus, setModelStatus] = useState<VoiceModelStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [modelActionBusy, setModelActionBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void window.electronAPI.voice.getConfig()
      .then((savedConfig) => {
        if (!cancelled) setConfig(normalizeConfig(savedConfig));
      })
      .catch((err: unknown) => {
        if (!cancelled) setMessage(`Unable to load voice dictation settings: ${getErrorMessage(err)}`);
      });

    void window.electronAPI.voice.getPermissionState()
      .then((state) => {
        if (!cancelled) setPermissionState(state);
      })
      .catch((err: unknown) => {
        if (!cancelled) setMessage(`Unable to read microphone permission: ${getErrorMessage(err)}`);
      });

    void window.electronAPI.voice.getModelStatus(VOICE_DICTATION_MODEL_ID)
      .then((status) => {
        if (!cancelled) setModelStatus(status);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setModelStatus({
            id: VOICE_DICTATION_MODEL_ID,
            status: 'error',
            errorMessage: getErrorMessage(err),
          });
        }
      });

    void enumerateAudioInputDevices()
      .then((devices) => {
        if (!cancelled) setAudioInputDevices(devices);
      })
      .catch((err: unknown) => {
        if (!cancelled) setMessage(`Unable to list input devices: ${getErrorMessage(err)}`);
      });

    const unsubscribeConfig = window.electronAPI.voice.onConfigChanged((nextConfig) => {
      setConfig(normalizeConfig(nextConfig));
    });
    const unsubscribeProgress = window.electronAPI.voice.onModelProgress((status) => {
      if (status.id === VOICE_DICTATION_MODEL_ID) setModelStatus(status);
    });

    return () => {
      cancelled = true;
      unsubscribeConfig();
      unsubscribeProgress();
    };
  }, []);

  const selectedDeviceValue = config.inputDeviceId ?? SYSTEM_DEFAULT_DEVICE_VALUE;
  const selectedDeviceMissing = useMemo(
    () => Boolean(config.inputDeviceId) && !audioInputDevices.some((device) => device.deviceId === config.inputDeviceId),
    [audioInputDevices, config.inputDeviceId],
  );
  const modelProgress = getDownloadProgressPercent(modelStatus);

  const saveVoiceConfig = async (nextConfig: VoiceDictationConfig) => {
    setConfig(nextConfig);
    setMessage(null);
    try {
      await window.electronAPI.voice.saveConfig(nextConfig);
    } catch (err) {
      setMessage(`Unable to save voice dictation settings: ${getErrorMessage(err)}`);
    }
  };

  const handleDeviceChange = (value: string) => {
    const inputDeviceId = value === SYSTEM_DEFAULT_DEVICE_VALUE ? null : value;
    void saveVoiceConfig({ ...config, inputDeviceId });
  };

  const handlePushToTalkToggle = () => {
    void saveVoiceConfig({ ...config, pushToTalk: !config.pushToTalk });
  };

  const handleOpenPreferences = async () => {
    setMessage(null);
    try {
      await window.electronAPI.voice.openMicPreferences();
      const nextState = await window.electronAPI.voice.getPermissionState();
      setPermissionState(nextState);
    } catch (err) {
      setMessage(`Unable to open microphone preferences: ${getErrorMessage(err)}`);
    }
  };

  const handleTestMic = async () => {
    setMicTest({ status: 'testing' });
    setMessage(null);
    try {
      const result = await window.electronAPI.voice.testMic();
      if (result.success) {
        setMicTest({ status: 'success', result });
      } else {
        setMicTest({ status: 'error', message: result.error });
      }
    } catch (err) {
      setMicTest({ status: 'error', message: getErrorMessage(err) });
    }
  };

  const handleModelAction = async () => {
    setModelActionBusy(true);
    setMessage(null);
    try {
      if (modelStatus?.status === 'downloading') {
        await window.electronAPI.voice.cancelDownload(VOICE_DICTATION_MODEL_ID);
      } else {
        setModelStatus((current) => ({
          id: VOICE_DICTATION_MODEL_ID,
          status: 'downloading',
          ...(current?.sizeBytes ? { sizeBytes: current.sizeBytes } : {}),
        }));
        await window.electronAPI.voice.downloadModel(VOICE_DICTATION_MODEL_ID);
      }
      const refreshed = await window.electronAPI.voice.getModelStatus(VOICE_DICTATION_MODEL_ID);
      setModelStatus(refreshed);
    } catch (err) {
      setModelStatus({
        id: VOICE_DICTATION_MODEL_ID,
        status: 'error',
        errorMessage: getErrorMessage(err),
      });
    } finally {
      setModelActionBusy(false);
    }
  };

  return (
    <section>
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
        Voice dictation
      </h2>
      <div className="space-y-4 rounded-lg border border-border bg-card p-4">
        <p className="text-sm text-muted-foreground">
          Dictate into Chamber locally. Audio stays on this device; transcripts are inserted into chat drafts and are never sent automatically.
        </p>

        <SettingsRow title="Input device" description="Choose the microphone Chamber should use for voice dictation.">
          <Select value={selectedDeviceValue} onValueChange={handleDeviceChange}>
            <SelectTrigger className="w-64 max-w-full bg-background" aria-label="Input device">
              <SelectValue placeholder="System default" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SYSTEM_DEFAULT_DEVICE_VALUE}>System default</SelectItem>
              {selectedDeviceMissing ? (
                <SelectItem value={config.inputDeviceId ?? SYSTEM_DEFAULT_DEVICE_VALUE}>Saved microphone unavailable</SelectItem>
              ) : null}
              {audioInputDevices.map((device) => (
                <SelectItem key={device.deviceId} value={device.deviceId}>
                  {device.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>

        <SettingsRow title="Microphone permissions" description="Chamber needs OS microphone access before it can record.">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={permissionTone(permissionState)}>{permissionLabel(permissionState)}</StatusPill>
            {permissionState !== 'unsupported' ? (
              <button
                type="button"
                onClick={() => { void handleOpenPreferences(); }}
                className="rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-accent"
              >
                Open preferences
              </button>
            ) : null}
          </div>
        </SettingsRow>

        <SettingsRow title="Test mic" description="Run a short local transcription check using the selected microphone.">
          <button
            type="button"
            onClick={() => { void handleTestMic(); }}
            disabled={micTest.status === 'testing'}
            className="rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-accent disabled:opacity-50"
          >
            {micTest.status === 'testing' ? 'Testing…' : 'Test mic'}
          </button>
          {micTest.status === 'success' ? (
            <p role="status" className="text-xs text-green-500">
              Microphone test passed{micTest.result.transcript ? `: “${micTest.result.transcript}”` : ''}
            </p>
          ) : null}
          {micTest.status === 'error' ? (
            <p role="alert" className="text-xs text-destructive">{micTest.message}</p>
          ) : null}
        </SettingsRow>

        <SettingsRow title="Shortcut" description="Renderer-only push-to-talk shortcut.">
          <div className="text-right">
            <p className="font-mono text-sm text-foreground">{config.shortcut || DEFAULT_SHORTCUT}</p>
            <p className="text-xs text-muted-foreground">Rebinding coming soon.</p>
          </div>
        </SettingsRow>

        <SettingsRow
          title="Keyboard shortcut behavior"
          description="Hold the keyboard shortcut to talk while pressed, or press it once to toggle dictation on and off. The mic button always toggles on click."
        >
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              {config.pushToTalk ? 'Hold to talk' : 'Press to toggle'}
            </span>
            <ToggleSwitch checked={config.pushToTalk} label="Keyboard shortcut behavior" onToggle={handlePushToTalkToggle} />
          </div>
        </SettingsRow>

        <SettingsRow title="Transcription model" description="Local ASR model used for dictation.">
          <div className="min-w-0 max-w-full space-y-2 text-right">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className="max-w-full truncate font-mono text-sm text-foreground">
                {VOICE_DICTATION_MODEL_ID}
              </span>
              <StatusPill tone={modelStatusTone(modelStatus)}>{modelStatusLabel(modelStatus)}</StatusPill>
              {modelStatus?.status === 'ready' ? <StatusPill tone="success">Selected</StatusPill> : null}
            </div>
            <p className="text-xs text-muted-foreground">{formatBytes(modelStatus?.sizeBytes)}</p>
            {modelStatus?.status === 'downloading' ? (
              <div
                role="progressbar"
                aria-label="Model download progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={modelProgress ?? 0}
                className="h-2 w-64 max-w-full overflow-hidden rounded-full bg-muted"
              >
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${modelProgress ?? 0}%` }} />
              </div>
            ) : null}
            {modelStatus?.status === 'error' && modelStatus.errorMessage ? (
              <p role="alert" className="text-xs text-destructive">{modelStatus.errorMessage}</p>
            ) : null}
            <button
              type="button"
              onClick={() => { void handleModelAction(); }}
              disabled={modelActionBusy || !modelStatus}
              className="rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-accent disabled:opacity-50"
            >
              {modelActionBusy ? 'Working…' : modelActionLabel(modelStatus)}
            </button>
          </div>
        </SettingsRow>

        {message ? (
          <p role="status" className="text-sm text-muted-foreground">{message}</p>
        ) : null}
      </div>
    </section>
  );
}
