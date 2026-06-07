// Azure Speech synthesizer factory (renderer).
//
// Isolated from useVoiceConversation so the hook's unit tests never import the
// Speech SDK (which touches browser-only globals). The hook lazy-imports this
// module only when it actually starts a real conversation session.

import * as SpeechSDK from 'microsoft-cognitiveservices-speech-sdk';
import type { VoiceSynthesizer, VoiceSynthesizerCallbacks } from '../hooks/useVoiceConversation';

export function createAzureSpeechSynthesizer(
  token: string,
  region: string,
  voice: string | undefined,
  callbacks: VoiceSynthesizerCallbacks,
): VoiceSynthesizer {
  const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(token, region);
  if (voice && voice.trim()) {
    speechConfig.speechSynthesisVoiceName = voice.trim();
  }
  // No AudioConfig argument: the SDK plays through the default speaker output.
  let synthesizer: SpeechSDK.SpeechSynthesizer | null = new SpeechSDK.SpeechSynthesizer(speechConfig);

  return {
    speak: (text) => new Promise<void>((resolve, reject) => {
      const active = synthesizer;
      if (!active) {
        resolve();
        return;
      }
      active.speakTextAsync(
        text,
        (result) => {
          if (result.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
            resolve();
          } else {
            const message = result.errorDetails || 'Speech synthesis failed.';
            callbacks.onError(message);
            reject(new Error(message));
          }
        },
        (err) => {
          callbacks.onError(err);
          reject(new Error(err));
        },
      );
    }),
    stop: () => {
      if (synthesizer) {
        synthesizer.close();
        synthesizer = null;
      }
    },
    setAuthToken: (next) => {
      if (synthesizer) {
        synthesizer.authorizationToken = next;
      }
    },
    dispose: () => {
      if (synthesizer) {
        synthesizer.close();
        synthesizer = null;
      }
    },
  };
}
