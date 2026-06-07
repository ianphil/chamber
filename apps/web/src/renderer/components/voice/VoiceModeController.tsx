import { useEffect, useRef, useState } from 'react';
import {
  useVoiceConversation,
  type VoiceSynthesizerFactory,
} from '../../hooks/useVoiceConversation';
import type { VoiceRecognizerFactory } from '../../hooks/useVoiceInput';
import type { AzureSpeechToken } from '@chamber/shared/types';
import { VoiceModeOverlay } from './VoiceModeOverlay';

/** The current assistant reply being streamed back, or null when none. */
export interface VoiceReplySource {
  id: string;
  text: string;
  streaming: boolean;
}

interface Props {
  /** Send a finalized user utterance to the model. */
  onUtterance: (text: string) => void;
  /** The latest assistant reply, fed to TTS as it streams. */
  reply: VoiceReplySource | null;
  /** Conversation partner name, shown in the overlay. */
  mindName?: string;
  /** Close the overlay and tear down the session. */
  onClose: () => void;
  // --- Test seams (omit in production) ---
  mintToken?: () => Promise<AzureSpeechToken | null>;
  createRecognizer?: VoiceRecognizerFactory;
  createSynthesizer?: VoiceSynthesizerFactory;
  /** When DI is supplied, these are used directly instead of loading config. */
  language?: string;
  voice?: string;
}

/**
 * Owns a hands-free voice conversation session and renders its overlay.
 *
 * Loads the configured STT language and TTS voice, starts the
 * {@link useVoiceConversation} session on mount, bridges the streaming
 * assistant reply into TTS, and tears everything down when closed. Replies
 * that began before the session opened are never spoken: only a reply whose
 * streaming starts while the session is active is read back.
 */
export function VoiceModeController({
  onUtterance,
  reply,
  mindName,
  onClose,
  mintToken,
  createRecognizer,
  createSynthesizer,
  language: languageProp,
  voice: voiceProp,
}: Props) {
  const usingTestSeams = Boolean(mintToken);
  const [language, setLanguage] = useState<string | undefined>(languageProp);
  const [voice, setVoice] = useState<string | undefined>(voiceProp);
  const [configReady, setConfigReady] = useState(usingTestSeams);

  // Load the configured language/voice before starting so the session is
  // created with the right locale and neural voice.
  useEffect(() => {
    if (usingTestSeams) return;
    let cancelled = false;
    window.electronAPI.azureSpeech.get().then((config) => {
      if (cancelled) return;
      setLanguage(config?.sttLanguage || undefined);
      setVoice(config?.ttsVoice || undefined);
      setConfigReady(true);
    }).catch(() => {
      if (!cancelled) setConfigReady(true);
    });
    return () => { cancelled = true; };
  }, [usingTestSeams]);

  const conversation = useVoiceConversation({
    onUtterance,
    language,
    voice,
    mintToken,
    createRecognizer,
    createSynthesizer,
  });

  // Start once config is ready; stop on unmount. Refs keep the start/stop
  // identities current without re-running the mount effect.
  const startRef = useRef(conversation.start);
  startRef.current = conversation.start;
  const stopRef = useRef(conversation.stop);
  stopRef.current = conversation.stop;
  const startedRef = useRef(false);

  useEffect(() => {
    if (!configReady || startedRef.current) return;
    startedRef.current = true;
    void startRef.current();
    return () => { void stopRef.current(); };
  }, [configReady]);

  // Bridge the streaming reply into TTS. Only a reply that begins streaming
  // while the session is active is spoken, and each reply is ended once.
  const spokenIdRef = useRef<string | null>(null);
  const endedIdRef = useRef<string | null>(null);
  const { isActive, updateReply, endReply } = conversation;

  useEffect(() => {
    if (!isActive || !reply) return;
    if (reply.streaming && spokenIdRef.current !== reply.id && endedIdRef.current !== reply.id) {
      spokenIdRef.current = reply.id;
    }
    if (spokenIdRef.current !== reply.id) return;
    updateReply(reply.text);
    if (!reply.streaming) {
      endReply();
      endedIdRef.current = reply.id;
      spokenIdRef.current = null;
    }
  }, [isActive, reply, updateReply, endReply]);

  return (
    <VoiceModeOverlay
      status={conversation.status}
      partialText={conversation.partialText}
      error={conversation.error}
      mindName={mindName}
      onClose={onClose}
    />
  );
}
