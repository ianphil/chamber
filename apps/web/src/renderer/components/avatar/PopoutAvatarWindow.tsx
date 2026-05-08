import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Captions, MessageSquare, Mic, X } from 'lucide-react';
import { useAppDispatch, useAppState } from '../../lib/store';
import { useChatStreaming } from '../../hooks/useChatStreaming';
import { ChatInput } from '../chat/ChatInput';
import { MessageList } from '../chat/MessageList';
import { cn } from '../../lib/utils';
import type { ChatMessage } from '@chamber/shared/types';
import {
  getLatestAssistantText,
  stripMarkdownForSpeech,
  takeSpeakableText,
} from './AgentAvatarPanel.logic';
import { AgentAvatarPanel } from './AgentAvatarPanel';

interface Props {
  popoutMindId: string | null;
}

export function PopoutAvatarWindow({ popoutMindId }: Props) {
  const {
    messagesByMind,
    activeMindId,
    minds,
    availableModels,
    selectedModel,
  } = useAppState();
  const dispatch = useAppDispatch();
  const { sendMessage, stopStreaming, isStreaming } = useChatStreaming();
  const [mode, setMode] = useState<'avatar' | 'transcript'>('avatar');
  const [captionsVisible, setCaptionsVisible] = useState(true);

  const mindId = popoutMindId ?? activeMindId;
  const activeMind = minds.find(m => m.mindId === mindId);
  const messages = mindId ? (messagesByMind[mindId] ?? []) : [];
  const connected = Boolean(activeMind);
  const agentName = activeMind?.identity.name ?? 'Agent';
  const assistantVoice = useAssistantVoice({
    messages,
    enabled: mode === 'avatar',
  });
  const voiceInput = useVoiceInput({
    disabled: !connected || mode !== 'avatar',
    onBeforeStart: () => {
      assistantVoice.interruptAndActivate();
      if (isStreaming) void stopStreaming();
    },
    onSubmit: sendMessage,
  });

  useEffect(() => {
    if (mode !== 'avatar' && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }, [mode]);

  if (mode === 'transcript') {
    return (
      <div className="flex h-full w-full flex-col bg-background text-foreground">
        <div className="titlebar-drag flex items-center justify-between border-b border-border px-5 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{agentName}</div>
            <div className="text-xs text-muted-foreground">Conversation transcript</div>
          </div>
          <button
            type="button"
            onClick={() => setMode('avatar')}
            className="titlebar-no-drag inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <MessageSquare size={14} />
            Avatar mode
          </button>
        </div>

        {messages.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-6 text-sm text-muted-foreground">
            No transcript yet. Return to avatar mode and use the microphone to start.
          </div>
        ) : (
          <MessageList />
        )}

        <ChatInput
          onSend={sendMessage}
          onStop={stopStreaming}
          isStreaming={isStreaming}
          disabled={!connected}
          availableModels={availableModels}
          selectedModel={selectedModel}
          onModelChange={(model) => dispatch({ type: 'SET_SELECTED_MODEL', payload: model })}
        />
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-background text-foreground">
      <AgentAvatarPanel
        layout="stage"
        messages={messages}
        isStreaming={isStreaming || voiceInput.isListening}
        agentName={agentName}
        connected={connected}
        captionsVisible={captionsVisible}
        stateOverride={voiceInput.isListening ? 'listening' : undefined}
      />

      <div className="pointer-events-none absolute inset-x-0 bottom-8 flex flex-col items-center gap-4 px-4">
        {(voiceInput.status || voiceInput.transcript) && (
          <div className="max-w-2xl rounded-2xl border border-white/10 bg-black/45 px-4 py-2 text-center text-sm text-white/80 shadow-2xl backdrop-blur">
            {voiceInput.transcript || voiceInput.status}
            {assistantVoice.status && (
              <div className="mt-1 text-xs text-white/55">{assistantVoice.status}</div>
            )}
          </div>
        )}

        <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-border bg-card/95 px-5 py-3 shadow-2xl">
          <button
            type="button"
            aria-label={captionsVisible ? 'Hide captions' : 'Show captions'}
            onClick={() => setCaptionsVisible(v => !v)}
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-full transition-colors',
              captionsVisible ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Captions size={20} />
          </button>

          <button
            type="button"
            aria-label={voiceInput.isListening ? 'Stop voice input' : 'Start voice input'}
            onClick={voiceInput.toggle}
            disabled={!connected}
            className={cn(
              'flex h-12 w-12 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50',
              voiceInput.isListening
                ? 'bg-sky-500 text-white shadow-[0_0_30px_rgba(56,189,248,0.45)]'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <Mic size={24} />
          </button>

          <button
            type="button"
            aria-label="Show transcript"
            onClick={() => setMode('transcript')}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-red-600 text-white shadow-[0_0_30px_rgba(220,38,38,0.35)] transition-colors hover:bg-red-500"
          >
            <X size={26} />
          </button>
        </div>
      </div>
    </div>
  );
}

function useAssistantVoice({ messages, enabled }: { messages: ChatMessage[]; enabled: boolean }) {
  const spokenRef = useRef<{ messageId: string | null; length: number }>({ messageId: null, length: 0 });
  const enabledRef = useRef(enabled);
  const activatedRef = useRef(false);
  const speakingRef = useRef(false);
  const queueRef = useRef<string[]>([]);
  const generationRef = useRef(0);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const currentAudioUrlRef = useRef<string | null>(null);
  const [status, setStatus] = useState('');

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const stopPlayback = useCallback(() => {
    generationRef.current += 1;
    queueRef.current = [];
    speakingRef.current = false;
    currentAudioRef.current?.pause();
    currentAudioRef.current = null;
    if (currentAudioUrlRef.current) {
      URL.revokeObjectURL(currentAudioUrlRef.current);
      currentAudioUrlRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setStatus('');
  }, []);

  const speakNext = useCallback(() => {
    if (
      speakingRef.current ||
      queueRef.current.length === 0 ||
      !enabledRef.current ||
      !activatedRef.current ||
      typeof window === 'undefined'
    ) {
      return;
    }

    const text = queueRef.current.shift();
    if (!text) return;
    const generation = generationRef.current;

    speakingRef.current = true;
    setStatus('Voice output speaking...');
    void playAssistantSpeech(text, {
      currentAudioRef,
      currentAudioUrlRef,
    }, () => generationRef.current === generation).catch((error: unknown) => {
      if (generationRef.current !== generation) return;
      console.warn('[avatar voice] Speech output failed:', error);
      setStatus('Voice output stopped. Check system audio output, then try again.');
    }).finally(() => {
      if (generationRef.current !== generation) return;
      speakingRef.current = false;
      setStatus('');
      speakNext();
    });
  }, []);

  const interruptAndActivate = useCallback(() => {
    stopPlayback();
    activatedRef.current = true;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.resume();
    }
    speakNext();
  }, [speakNext, stopPlayback]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    const latestAssistant = getLatestAssistantText(messages);
    if (!latestAssistant) return;

    if (spokenRef.current.messageId !== latestAssistant.messageId) {
      spokenRef.current = { messageId: latestAssistant.messageId, length: 0 };
      stopPlayback();
    }

    const pendingText = latestAssistant.text.slice(spokenRef.current.length);
    const speakable = takeSpeakableText(pendingText)
      ?? (!latestAssistant.isStreaming && pendingText.trim().length > 2
        ? { text: pendingText, consumed: pendingText.length }
        : null);
    if (!speakable) return;

    spokenRef.current.length += speakable.consumed;
    const text = stripMarkdownForSpeech(speakable.text);
    if (!text) return;

    queueRef.current.push(text);
    speakNext();
  }, [enabled, messages, speakNext, stopPlayback]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    if ('speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = () => speakNext();
    }

    return () => {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.onvoiceschanged = null;
      }
      stopPlayback();
    };
  }, [speakNext, stopPlayback]);

  return { interruptAndActivate, status };
}

function useVoiceInput({
  disabled,
  onBeforeStart,
  onSubmit,
}: {
  disabled: boolean;
  onBeforeStart: () => void;
  onSubmit: (message: string) => void;
}) {
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const stopRequestedRef = useRef(false);
  const startingRef = useRef(false);
  const recognitionActiveRef = useRef(false);
  const [isListening, setIsListening] = useState(false);
  const [status, setStatus] = useState('Press the microphone and speak to your agent.');
  const [transcript, setTranscript] = useState('');

  const stop = useCallback(() => {
    stopRequestedRef.current = true;
    setStatus('Stopping voice input...');
    if (recognitionActiveRef.current) {
      void window.electronAPI.voice.stopRecognition();
    }
  }, []);

  const start = useCallback(async () => {
    if (disabled || startingRef.current) return;

    startingRef.current = true;
    stopRequestedRef.current = false;
    onBeforeStart();
    setTranscript('');
    setStatus('Checking microphone access...');

    let stream: MediaStream | null = null;
    try {
      stream = await requestMicrophoneAccess();
    } catch (error) {
      startingRef.current = false;
      setIsListening(false);
      setStatus(getMicrophoneErrorMessage(error));
      return;
    }

    stopMediaStream(stream);
    mediaStreamRef.current = null;
    if (stopRequestedRef.current) {
      startingRef.current = false;
      setStatus('Stopped listening.');
      return;
    }

    setIsListening(true);
    setStatus('Listening with Windows speech... speak now.');
    recognitionActiveRef.current = true;

    try {
      const result = await window.electronAPI.voice.recognizeOnce({
        language: 'en-US',
        timeoutMs: 30000,
      });
      recognitionActiveRef.current = false;
      setIsListening(false);
      startingRef.current = false;
      setTranscript('');

      if (stopRequestedRef.current) {
        setStatus('Stopped listening.');
        return;
      }

      const spokenText = result.text?.trim();
      if (spokenText) {
        setStatus('Sending...');
        onSubmit(spokenText);
        return;
      }

      setStatus(result.error ?? 'No speech recognized. Try again after the listening indicator appears.');
    } catch (error) {
      recognitionActiveRef.current = false;
      startingRef.current = false;
      setIsListening(false);
      setTranscript('');
      setStatus(error instanceof Error ? error.message : 'Could not start local voice input.');
    }
  }, [disabled, onBeforeStart, onSubmit]);

  useEffect(() => () => {
    if (recognitionActiveRef.current) void window.electronAPI.voice.stopRecognition();
    stopMediaStream(mediaStreamRef.current);
  }, []);

  return {
    isListening,
    status,
    transcript,
    toggle: isListening ? stop : start,
  };
}

async function requestMicrophoneAccess(): Promise<MediaStream | null> {
  if (!navigator.mediaDevices?.getUserMedia) return null;

  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
    },
  });
}

function stopMediaStream(stream: MediaStream | null) {
  stream?.getTracks().forEach(track => track.stop());
}

function getMicrophoneErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Microphone permission was blocked. Allow microphone access for Chamber in Windows/privacy settings and try again.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No microphone was found. Connect or select an input device, then try again.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'The microphone is busy or unavailable. Close other apps using it, then try again.';
  }
  return 'Could not access the microphone. Check your input device and try again.';
}

function chooseAssistantVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  return voices.find(voice => voice.lang === 'en-US' && /Jenny|Aria|Emma|Michelle|Samantha/i.test(voice.name))
    ?? voices.find(voice => voice.lang === 'en-US')
    ?? voices.find(voice => voice.lang.startsWith('en'))
    ?? null;
}

async function playAssistantSpeech(
  text: string,
  refs: {
    currentAudioRef: React.MutableRefObject<HTMLAudioElement | null>;
    currentAudioUrlRef: React.MutableRefObject<string | null>;
  },
  shouldContinue: () => boolean,
): Promise<void> {
  try {
    const result = await window.electronAPI.voice.synthesize(text);
    if (result.audioBase64) {
      const blob = base64AudioToBlob(result.audioBase64, result.mimeType ?? 'audio/mpeg');
      if (!shouldContinue()) return;
      await playAudioBlob(blob, refs, shouldContinue);
      return;
    }
    if (result.error) {
      console.warn('[avatar voice] Edge TTS failed, falling back to browser speech:', result.error);
    }
  } catch (error) {
    console.warn('[avatar voice] Edge TTS failed, falling back to browser speech:', error);
  }

  if (!shouldContinue()) return;
  await speakWithBrowserSpeech(text);
}

function base64AudioToBlob(audioBase64: string, mimeType: string): Blob {
  const binary = window.atob(audioBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}

async function playAudioBlob(
  blob: Blob,
  refs: {
    currentAudioRef: React.MutableRefObject<HTMLAudioElement | null>;
    currentAudioUrlRef: React.MutableRefObject<string | null>;
  },
  shouldContinue: () => boolean,
): Promise<void> {
  if (!shouldContinue()) return;
  const url = URL.createObjectURL(blob);
  refs.currentAudioUrlRef.current = url;
  const audio = new Audio(url);
  refs.currentAudioRef.current = audio;
  audio.volume = 1;

  try {
    await audio.play();
    await new Promise<void>((resolve, reject) => {
      audio.onended = () => resolve();
      audio.onpause = () => resolve();
      audio.onerror = () => reject(new Error('Audio playback failed.'));
    });
  } finally {
    if (refs.currentAudioRef.current === audio) refs.currentAudioRef.current = null;
    if (refs.currentAudioUrlRef.current === url) refs.currentAudioUrlRef.current = null;
    URL.revokeObjectURL(url);
  }
}

function speakWithBrowserSpeech(text: string): Promise<void> {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return Promise.reject(new Error('Browser speech synthesis is unavailable.'));
  }

  return new Promise((resolve, reject) => {
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = chooseAssistantVoice(window.speechSynthesis.getVoices());
    if (voice) utterance.voice = voice;
    utterance.rate = 0.95;
    utterance.pitch = 1.02;
    utterance.onend = () => resolve();
    utterance.onerror = () => reject(new Error('Browser speech synthesis failed.'));
    window.speechSynthesis.resume();
    window.speechSynthesis.speak(utterance);
  });
}
