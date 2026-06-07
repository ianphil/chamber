// Azure Speech recognizer factory (renderer).
//
// Isolated from useVoiceInput so the hook's unit tests never import the Speech
// SDK (which touches browser-only globals). The hook lazy-imports this module
// only when it actually starts a real recognition session.

import * as SpeechSDK from 'microsoft-cognitiveservices-speech-sdk';
import type { VoiceRecognizer, VoiceRecognizerCallbacks } from '../hooks/useVoiceInput';

export function createAzureSpeechRecognizer(
  token: string,
  region: string,
  language: string | undefined,
  callbacks: VoiceRecognizerCallbacks,
): VoiceRecognizer {
  const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(token, region);
  if (language && language.trim()) {
    speechConfig.speechRecognitionLanguage = language.trim();
  }
  const audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
  const recognizer = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);

  recognizer.recognizing = (_sender, event) => {
    if (event.result.text) callbacks.onPartial(event.result.text);
  };
  recognizer.recognized = (_sender, event) => {
    if (event.result.reason === SpeechSDK.ResultReason.RecognizedSpeech && event.result.text) {
      callbacks.onFinal(event.result.text);
    }
  };
  recognizer.canceled = (_sender, event) => {
    callbacks.onError(event.errorDetails || 'Speech recognition was canceled.');
  };

  return {
    start: () => new Promise<void>((resolve, reject) => {
      recognizer.startContinuousRecognitionAsync(() => resolve(), (err) => reject(new Error(err)));
    }),
    stop: () => new Promise<void>((resolve, reject) => {
      recognizer.stopContinuousRecognitionAsync(() => resolve(), (err) => reject(new Error(err)));
    }),
    setAuthToken: (next) => {
      recognizer.authorizationToken = next;
    },
    dispose: () => recognizer.close(),
  };
}
