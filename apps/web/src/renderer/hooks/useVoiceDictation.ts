import { useCallback, useEffect, useRef, useState } from 'react';
import {
  VOICE_DICTATION_MODEL_ID,
  VOICE_MAX_APPEND_CHUNK_BYTES,
  type TranscriptionEvent,
  type VoicePermissionState,
} from '@chamber/shared/voice-types';
import { getErrorMessage } from '@chamber/shared/getErrorMessage';
import { startMicCapture, type MicCaptureSession } from '../lib/audio/captureMic';
import { chunkPcm16Bytes, downsampleFloat32, float32ToPcm16, pcm16ToBytes } from '../lib/audio/pcm16Encoder';

export type VoiceDictationState = 'idle' | 'listening' | 'error';

export interface UseVoiceDictationOptions {
  enabled: boolean;
  shortcut: string;
  pushToTalk: boolean;
  onFinalTranscript: (text: string) => void;
  onPartialTranscript?: (text: string) => void;
}

export interface UseVoiceDictationResult {
  state: VoiceDictationState;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  error: string | null;
  permission: VoicePermissionState | null;
  __currentSessionId: string | null;
}

export function useVoiceDictation(options: UseVoiceDictationOptions): UseVoiceDictationResult {
  const [state, setState] = useState<VoiceDictationState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [permission, setPermission] = useState<VoicePermissionState | null>(null);
  const optionsRef = useRef(options);
  const sessionIdRef = useRef<string | null>(null);
  const captureRef = useRef<MicCaptureSession | null>(null);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    if (!options.enabled) return;
    let cancelled = false;
    window.electronAPI.voice.getPermissionState().then((nextPermission) => {
      if (!cancelled) setPermission(nextPermission);
    }).catch((err) => {
      if (!cancelled) {
        setPermission('unsupported');
        setError(getErrorMessage(err));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [options.enabled]);

  useEffect(() => {
    if (!options.enabled || permission !== 'granted') return;
    return window.electronAPI.voice.onTranscript((event: TranscriptionEvent) => {
      if (event.sessionId !== sessionIdRef.current) return;
      if (event.type === 'final') {
        optionsRef.current.onFinalTranscript(event.text);
        return;
      }
      if (event.type === 'partial') {
        optionsRef.current.onPartialTranscript?.(event.text);
        return;
      }
      if (event.type === 'error') {
        setError(event.message);
        setState('error');
        return;
      }
      if (event.type === 'sessionEnded') {
        sessionIdRef.current = null;
        setState('idle');
      }
    });
  }, [options.enabled, permission]);

  const stop = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    sessionIdRef.current = null;

    const capture = captureRef.current;
    captureRef.current = null;

    let captureError: unknown = null;
    try {
      await capture?.stop();
    } catch (err) {
      captureError = err;
    }

    try {
      await window.electronAPI.voice.endSession({ sessionId });
    } catch (err) {
      // endSession failure is reported but we still want to clear UI state.
      if (!captureError) captureError = err;
    }

    if (captureError) {
      setError(getErrorMessage(captureError));
      setState('error');
      return;
    }
    setState('idle');
  }, []);

  const start = useCallback(async () => {
    if (!optionsRef.current.enabled || sessionIdRef.current) return;
    setError(null);

    const nextPermission = await window.electronAPI.voice.getPermissionState();
    setPermission(nextPermission);
    if (nextPermission !== 'granted') {
      const err = new Error(`Microphone permission is ${nextPermission}`);
      setError(err.message);
      setState('error');
      throw err;
    }

    const config = await window.electronAPI.voice.getConfig();
    const modelId = config?.model.id ?? VOICE_DICTATION_MODEL_ID;
    const sessionId = createSessionId();
    sessionIdRef.current = sessionId;
    setState('listening');

    try {
      await window.electronAPI.voice.startSession({ sessionId, modelId });
      const capture = await startMicCapture({
        deviceId: config?.inputDeviceId ?? undefined,
        onFrame: (frame) => { void appendFrame(sessionId, frame).catch((err) => {
          // Append failure: stop the session so we don't leak it.
          setError(getErrorMessage(err));
          void stop().catch(() => undefined);
        }); },
      });
      captureRef.current = capture;
    } catch (err) {
      sessionIdRef.current = null;
      const capture = captureRef.current;
      captureRef.current = null;
      await capture?.stop().catch(() => undefined);
      await window.electronAPI.voice.endSession({ sessionId }).catch(() => undefined);
      setError(getErrorMessage(err));
      setState('error');
      throw err;
    }
  }, [stop]);

  useEffect(() => {
    if (!options.enabled || !options.shortcut.trim()) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.isComposing || !matchesShortcut(event, options.shortcut)) return;
      event.preventDefault();
      if (options.pushToTalk) {
        void start().catch(() => undefined);
      } else if (sessionIdRef.current) {
        void stop().catch(() => undefined);
      } else {
        void start().catch(() => undefined);
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (!options.pushToTalk || event.isComposing || !matchesShortcut(event, options.shortcut)) return;
      event.preventDefault();
      void stop().catch(() => undefined);
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
    };
  }, [options.enabled, options.pushToTalk, options.shortcut, start, stop]);

  // Tear down when disabled flips false mid-session (Blocking #2).
  useEffect(() => {
    if (options.enabled) return;
    if (sessionIdRef.current) {
      void stop().catch(() => undefined);
    }
  }, [options.enabled, stop]);

  useEffect(() => {
    return () => {
      const sessionId = sessionIdRef.current;
      sessionIdRef.current = null;
      const capture = captureRef.current;
      captureRef.current = null;
      void capture?.stop();
      if (sessionId) void window.electronAPI.voice.endSession({ sessionId });
    };
  }, []);

  return { state, start, stop, error, permission, __currentSessionId: sessionIdRef.current };
}

async function appendFrame(sessionId: string, frame: Float32Array): Promise<void> {
  const downsampled = downsampleFloat32(frame, 48_000, 16_000);
  const pcm = float32ToPcm16(downsampled);
  const bytes = pcm16ToBytes(pcm);
  // Await each chunk so backpressure propagates to the worklet onmessage loop.
  for (const chunk of chunkPcm16Bytes(bytes, VOICE_MAX_APPEND_CHUNK_BYTES)) {
    await window.electronAPI.voice.appendAudio({ sessionId, chunk });
  }
}

function createSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `voice-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut
    .split('+')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  if (parts.length === 0) return false;

  const key = parts[parts.length - 1];
  const modifiers = new Set(parts.slice(0, -1));
  const wantsCtrl = modifiers.has('ctrl') || modifiers.has('control');
  const wantsAlt = modifiers.has('alt') || modifiers.has('option');
  const wantsShift = modifiers.has('shift');
  const wantsMeta = modifiers.has('meta') || modifiers.has('cmd') || modifiers.has('command');
  if (event.ctrlKey !== wantsCtrl) return false;
  if (event.altKey !== wantsAlt) return false;
  if (event.shiftKey !== wantsShift) return false;
  if (event.metaKey !== wantsMeta) return false;

  const eventKey = event.key.toLowerCase();
  if (key === 'space') return eventKey === ' ';
  return eventKey === key;
}
