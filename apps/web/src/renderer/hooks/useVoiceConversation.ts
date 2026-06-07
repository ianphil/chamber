import { useCallback, useEffect, useRef, useState } from 'react';
import { getErrorMessage } from '@chamber/shared/getErrorMessage';
import type { AzureSpeechToken } from '@chamber/shared/types';
import type {
  VoiceRecognizer,
  VoiceRecognizerCallbacks,
  VoiceRecognizerFactory,
} from './useVoiceInput';
import { splitIntoSentences, stripSpeechMarkup } from '../lib/sentenceChunker';

export type VoiceConversationStatus =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'error';

/**
 * Re-mint the authorization token this many milliseconds before it expires.
 * Azure Speech tokens live ~9 minutes; refreshing early keeps a long
 * conversation alive without a gap.
 */
const TOKEN_REFRESH_SKEW_MS = 60_000;
/** Retry delay after a failed refresh while the session is still live. */
const TOKEN_REFRESH_RETRY_MS = 10_000;

/** A live neural TTS session. Returned by a {@link VoiceSynthesizerFactory}. */
export interface VoiceSynthesizer {
  /** Synthesize and play a chunk of text; resolves when playback completes. */
  speak(text: string): Promise<void>;
  /** Halt current playback and release the synthesizer. */
  stop(): void;
  dispose(): void;
  /** Rotate the authorization token on a live session before the old one expires. */
  setAuthToken?(token: string): void;
}

export interface VoiceSynthesizerCallbacks {
  onError(message: string): void;
}

export type VoiceSynthesizerFactory = (
  token: string,
  region: string,
  voice: string | undefined,
  callbacks: VoiceSynthesizerCallbacks,
) => VoiceSynthesizer | Promise<VoiceSynthesizer>;

export interface UseVoiceConversationOptions {
  /** Called with each finalized user utterance so the caller can send it. */
  onUtterance: (text: string) => void;
  /** STT language tag (e.g. en-US). */
  language?: string;
  /** Neural TTS voice (e.g. en-US-AvaNeural). */
  voice?: string;
  /** Overridable for tests. Defaults to the preload Azure Speech bridge. */
  mintToken?: () => Promise<AzureSpeechToken | null>;
  /** Overridable for tests. Defaults to the SDK-backed recognizer. */
  createRecognizer?: VoiceRecognizerFactory;
  /** Overridable for tests. Defaults to the SDK-backed synthesizer. */
  createSynthesizer?: VoiceSynthesizerFactory;
}

export interface UseVoiceConversationResult {
  status: VoiceConversationStatus;
  /** In-flight STT partial transcript. */
  partialText: string;
  error: string | null;
  /** True while a session is running (not idle and not errored out). */
  isActive: boolean;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  /** Feed the latest cumulative assistant reply text so TTS can speak it. */
  updateReply: (fullText: string) => void;
  /** Mark the current reply complete: flush the tail and resume listening. */
  endReply: () => void;
}

/**
 * Hands-free voice conversation backed by Azure Speech.
 *
 * Runs continuous recognition; each finalized utterance is handed to
 * {@link UseVoiceConversationOptions.onUtterance} (the caller sends it to the
 * model). The caller streams the assistant reply back via {@link updateReply}
 * and signals completion via {@link endReply}; the hook sentence-chunks the
 * reply and speaks it through a sequential neural-TTS queue, then returns to
 * listening. Utterances arriving while thinking or speaking are ignored
 * (barge-in is a later phase), which also stops the spoken reply from being
 * recognized as a new turn.
 */
export function useVoiceConversation(options: UseVoiceConversationOptions): UseVoiceConversationResult {
  const [status, setStatusState] = useState<VoiceConversationStatus>('idle');
  const [partialText, setPartialText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const statusRef = useRef<VoiceConversationStatus>('idle');
  const activeRef = useRef(false);
  const recognizerRef = useRef<VoiceRecognizer | null>(null);
  const synthesizerRef = useRef<VoiceSynthesizer | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // TTS queue + streaming-reply chunker state.
  const queueRef = useRef<string[]>([]);
  const drainingRef = useRef(false);
  const replyEndedRef = useRef(false);
  const bufferRef = useRef('');
  const lastReplyLenRef = useRef(0);

  const applyStatus = useCallback((next: VoiceConversationStatus) => {
    statusRef.current = next;
    setStatusState(next);
  }, []);

  const clearRefreshTimer = useCallback(() => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  }, []);

  // Re-mint the auth token shortly before it expires and push it onto the live
  // recognizer and synthesizer so a long conversation never drops mid-session.
  const scheduleTokenRefresh = useCallback((expiresAt: number) => {
    clearRefreshTimer();
    const delay = Math.max(0, expiresAt - Date.now() - TOKEN_REFRESH_SKEW_MS);
    refreshTimerRef.current = setTimeout(() => {
      void (async () => {
        if (!activeRef.current) return;
        const { mintToken } = optionsRef.current;
        const mint = mintToken ?? (() => window.electronAPI.azureSpeech.mintToken());
        let next: AzureSpeechToken | null;
        try {
          next = await mint();
        } catch {
          next = null;
        }
        if (!activeRef.current) return;
        if (next) {
          recognizerRef.current?.setAuthToken?.(next.token);
          synthesizerRef.current?.setAuthToken?.(next.token);
          scheduleTokenRefresh(next.expiresAt);
        } else {
          // Transient failure: retry while the session is still live.
          scheduleTokenRefresh(Date.now() + TOKEN_REFRESH_RETRY_MS);
        }
      })();
    }, delay);
  }, [clearRefreshTimer]);

  const drainQueue = useCallback(async () => {
    if (drainingRef.current) return;
    drainingRef.current = true;
    try {
      while (queueRef.current.length > 0) {
        const synth = synthesizerRef.current;
        if (!synth) break;
        applyStatus('speaking');
        const text = queueRef.current.shift() as string;
        try {
          await synth.speak(text);
        } catch {
          // onError already surfaced the failure; abandon the queue.
          queueRef.current = [];
          break;
        }
      }
    } finally {
      drainingRef.current = false;
      if (queueRef.current.length === 0 && activeRef.current) {
        if (replyEndedRef.current) {
          replyEndedRef.current = false;
          applyStatus(recognizerRef.current ? 'listening' : 'idle');
        }
        // Otherwise the reply is still streaming and more sentences are coming.
        // Hold 'speaking' rather than strobing to 'thinking' between chunks.
      }
    }
  }, [applyStatus]);

  const enqueueSentence = useCallback((text: string) => {
    const speakable = stripSpeechMarkup(text);
    if (!speakable) return;
    queueRef.current.push(speakable);
    void drainQueue();
  }, [drainQueue]);

  const updateReply = useCallback((fullText: string) => {
    if (!activeRef.current) return;
    // A shorter buffer than last time means a new reply has started.
    if (fullText.length < lastReplyLenRef.current) {
      bufferRef.current = '';
      lastReplyLenRef.current = 0;
    }
    const delta = fullText.slice(lastReplyLenRef.current);
    lastReplyLenRef.current = fullText.length;
    if (!delta) return;
    bufferRef.current += delta;
    const { sentences, rest } = splitIntoSentences(bufferRef.current);
    bufferRef.current = rest;
    for (const sentence of sentences) enqueueSentence(sentence);
  }, [enqueueSentence]);

  const endReply = useCallback(() => {
    if (!activeRef.current) return;
    const tail = bufferRef.current;
    bufferRef.current = '';
    lastReplyLenRef.current = 0;
    replyEndedRef.current = true;
    if (tail.trim()) enqueueSentence(tail);
    else void drainQueue();
  }, [enqueueSentence, drainQueue]);

  const teardown = useCallback(() => {
    clearRefreshTimer();
    const recognizer = recognizerRef.current;
    const synthesizer = synthesizerRef.current;
    recognizerRef.current = null;
    synthesizerRef.current = null;
    queueRef.current = [];
    drainingRef.current = false;
    replyEndedRef.current = false;
    bufferRef.current = '';
    lastReplyLenRef.current = 0;
    setPartialText('');
    if (recognizer) {
      void Promise.resolve(recognizer.stop()).catch(() => undefined);
      recognizer.dispose();
    }
    if (synthesizer) synthesizer.dispose();
  }, [clearRefreshTimer]);

  const stop = useCallback(async () => {
    activeRef.current = false;
    teardown();
    applyStatus('idle');
  }, [teardown, applyStatus]);

  const start = useCallback(async () => {
    if (recognizerRef.current) return;
    setError(null);
    setPartialText('');

    const { mintToken, createRecognizer, createSynthesizer, language, voice } = optionsRef.current;
    const mint = mintToken ?? (() => window.electronAPI.azureSpeech.mintToken());

    let tokenInfo: AzureSpeechToken | null;
    try {
      tokenInfo = await mint();
    } catch (err) {
      applyStatus('error');
      setError(getErrorMessage(err));
      return;
    }
    if (!tokenInfo) {
      applyStatus('error');
      setError('Voice conversation is not configured. Add an Azure Speech key in Settings.');
      return;
    }

    const recognizerFactory: VoiceRecognizerFactory = createRecognizer
      ?? (async (token, region, lang, callbacks) => {
        const { createAzureSpeechRecognizer } = await import('../lib/azureSpeechRecognizer');
        return createAzureSpeechRecognizer(token, region, lang, callbacks);
      });
    const synthesizerFactory: VoiceSynthesizerFactory = createSynthesizer
      ?? (async (token, region, v, callbacks) => {
        const { createAzureSpeechSynthesizer } = await import('../lib/azureSpeechSynthesizer');
        return createAzureSpeechSynthesizer(token, region, v, callbacks);
      });

    const recognizerCallbacks: VoiceRecognizerCallbacks = {
      onPartial: (text) => {
        if (statusRef.current === 'listening') setPartialText(text);
      },
      onFinal: (text) => {
        // Ignore anything captured while the assistant is thinking or speaking.
        if (statusRef.current !== 'listening') return;
        setPartialText('');
        applyStatus('thinking');
        optionsRef.current.onUtterance(text);
      },
      onError: (message) => {
        activeRef.current = false;
        teardown();
        setError(message);
        applyStatus('error');
      },
    };

    let synthesizer: VoiceSynthesizer;
    let recognizer: VoiceRecognizer;
    try {
      synthesizer = await synthesizerFactory(tokenInfo.token, tokenInfo.region, voice, {
        onError: (message) => setError(message),
      });
      recognizer = await recognizerFactory(tokenInfo.token, tokenInfo.region, language, recognizerCallbacks);
      await recognizer.start();
    } catch (err) {
      if (synthesizer!) synthesizer!.dispose();
      if (recognizer!) recognizer!.dispose();
      recognizerRef.current = null;
      synthesizerRef.current = null;
      applyStatus('error');
      setError(getErrorMessage(err));
      return;
    }

    synthesizerRef.current = synthesizer;
    recognizerRef.current = recognizer;
    activeRef.current = true;
    applyStatus('listening');
    scheduleTokenRefresh(tokenInfo.expiresAt);
  }, [teardown, applyStatus, scheduleTokenRefresh]);

  useEffect(() => () => {
    activeRef.current = false;
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    const recognizer = recognizerRef.current;
    const synthesizer = synthesizerRef.current;
    recognizerRef.current = null;
    synthesizerRef.current = null;
    if (recognizer) {
      void Promise.resolve(recognizer.stop()).catch(() => undefined);
      recognizer.dispose();
    }
    if (synthesizer) synthesizer.dispose();
  }, []);

  return {
    status,
    partialText,
    error,
    isActive: status !== 'idle' && status !== 'error',
    start,
    stop,
    updateReply,
    endReply,
  };
}
