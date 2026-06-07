import { useCallback, useEffect, useRef, useState } from 'react';
import { getErrorMessage } from '@chamber/shared/getErrorMessage';
import type { AzureSpeechToken } from '@chamber/shared/types';

export type VoiceInputStatus = 'idle' | 'starting' | 'listening' | 'error';

/**
 * Re-mint the authorization token this many milliseconds before it expires.
 * Azure Speech tokens live ~9 minutes; refreshing early keeps a long dictation
 * session alive without a gap.
 */
const TOKEN_REFRESH_SKEW_MS = 60_000;
/** Retry delay after a failed refresh while the session is still live. */
const TOKEN_REFRESH_RETRY_MS = 10_000;

/** A live recognition session. Returned by a {@link VoiceRecognizerFactory}. */
export interface VoiceRecognizer {
  start(): Promise<void>;
  stop(): Promise<void>;
  dispose(): void;
  /** Rotate the authorization token on a live session before the old one expires. */
  setAuthToken?(token: string): void;
}

export interface VoiceRecognizerCallbacks {
  onPartial(text: string): void;
  onFinal(text: string): void;
  onError(message: string): void;
}

export type VoiceRecognizerFactory = (
  token: string,
  region: string,
  language: string | undefined,
  callbacks: VoiceRecognizerCallbacks,
) => VoiceRecognizer | Promise<VoiceRecognizer>;

export interface UseVoiceInputOptions {
  /** Called with each finalized utterance so the caller can append it. */
  onFinalTranscript: (text: string) => void;
  /** STT language tag (e.g. en-US). Optional: defaults to the service default. */
  language?: string;
  /** Overridable for tests. Defaults to the preload Azure Speech bridge. */
  mintToken?: () => Promise<AzureSpeechToken | null>;
  /** Overridable for tests. Defaults to the SDK-backed recognizer. */
  createRecognizer?: VoiceRecognizerFactory;
}

export interface UseVoiceInputResult {
  status: VoiceInputStatus;
  partialText: string;
  error: string | null;
  isListening: boolean;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  toggle: () => void;
}

/**
 * Microphone dictation backed by Azure Speech continuous recognition.
 *
 * Mints a short-lived authorization token from the main process (the
 * subscription key never reaches the renderer), opens a recognizer, and
 * forwards finalized utterances to {@link UseVoiceInputOptions.onFinalTranscript}
 * while surfacing the in-flight partial transcript for live display.
 */
export function useVoiceInput(options: UseVoiceInputOptions): UseVoiceInputResult {
  const [status, setStatus] = useState<VoiceInputStatus>('idle');
  const [partialText, setPartialText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recognizerRef = useRef<VoiceRecognizer | null>(null);
  // True between the moment start() is invoked and the recognizer going live or
  // failing. Guards double-start while the token is still being minted.
  const startingRef = useRef(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the latest options without re-creating the start/stop callbacks.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const clearRefreshTimer = useCallback(() => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  }, []);

  // Re-mint the auth token shortly before it expires and push it onto the live
  // recognizer so a long dictation session never drops on token expiry.
  const scheduleTokenRefresh = useCallback((expiresAt: number) => {
    clearRefreshTimer();
    const delay = Math.max(0, expiresAt - Date.now() - TOKEN_REFRESH_SKEW_MS);
    refreshTimerRef.current = setTimeout(() => {
      void (async () => {
        if (!recognizerRef.current) return;
        const { mintToken } = optionsRef.current;
        const mint = mintToken ?? (() => window.electronAPI.azureSpeech.mintToken());
        let next: AzureSpeechToken | null;
        try {
          next = await mint();
        } catch {
          next = null;
        }
        if (!recognizerRef.current) return;
        if (next) {
          recognizerRef.current.setAuthToken?.(next.token);
          scheduleTokenRefresh(next.expiresAt);
        } else {
          // Transient failure: retry while we still have a live session.
          scheduleTokenRefresh(Date.now() + TOKEN_REFRESH_RETRY_MS);
        }
      })();
    }, delay);
  }, [clearRefreshTimer]);

  const teardown = useCallback(() => {
    clearRefreshTimer();
    const recognizer = recognizerRef.current;
    recognizerRef.current = null;
    setPartialText('');
    if (recognizer) {
      void Promise.resolve(recognizer.stop()).catch(() => undefined);
      recognizer.dispose();
    }
  }, [clearRefreshTimer]);

  const stop = useCallback(async () => {
    startingRef.current = false;
    teardown();
    setStatus('idle');
  }, [teardown]);

  const start = useCallback(async () => {
    if (recognizerRef.current || startingRef.current) return;
    startingRef.current = true;
    setError(null);
    setPartialText('');
    setStatus('starting');

    const { mintToken, createRecognizer, language } = optionsRef.current;
    const mint = mintToken ?? (() => window.electronAPI.azureSpeech.mintToken());

    let tokenInfo: AzureSpeechToken | null;
    try {
      tokenInfo = await mint();
    } catch (err) {
      startingRef.current = false;
      setStatus('error');
      setError(getErrorMessage(err));
      return;
    }
    if (!tokenInfo) {
      startingRef.current = false;
      setStatus('error');
      setError('Voice input is not configured. Add an Azure Speech key in Settings.');
      return;
    }

    const factory: VoiceRecognizerFactory = createRecognizer
      ?? (async (token, region, lang, callbacks) => {
        const { createAzureSpeechRecognizer } = await import('../lib/azureSpeechRecognizer');
        return createAzureSpeechRecognizer(token, region, lang, callbacks);
      });

    let recognizer: VoiceRecognizer;
    try {
      recognizer = await factory(tokenInfo.token, tokenInfo.region, language, {
        onPartial: (text) => setPartialText(text),
        onFinal: (text) => {
          setPartialText('');
          optionsRef.current.onFinalTranscript(text);
        },
        onError: (message) => {
          teardown();
          setError(message);
          setStatus('error');
        },
      });
      await recognizer.start();
    } catch (err) {
      if (recognizer!) recognizer!.dispose();
      recognizerRef.current = null;
      startingRef.current = false;
      setStatus('error');
      setError(getErrorMessage(err));
      return;
    }

    recognizerRef.current = recognizer;
    startingRef.current = false;
    setStatus('listening');
    scheduleTokenRefresh(tokenInfo.expiresAt);
  }, [teardown, scheduleTokenRefresh]);

  const toggle = useCallback(() => {
    if (recognizerRef.current) {
      void stop();
      return;
    }
    if (startingRef.current) return;
    void start();
  }, [start, stop]);

  useEffect(() => () => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    const recognizer = recognizerRef.current;
    recognizerRef.current = null;
    if (recognizer) {
      void Promise.resolve(recognizer.stop()).catch(() => undefined);
      recognizer.dispose();
    }
  }, []);

  return {
    status,
    partialText,
    error,
    isListening: status === 'listening',
    start,
    stop,
    toggle,
  };
}
