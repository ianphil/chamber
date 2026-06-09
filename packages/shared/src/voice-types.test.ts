import { describe, expect, expectTypeOf, it } from 'vitest';

import type {
  TranscriptionEvent,
  VoiceDictationConfig,
  VoiceDictationModelConfig,
  VoiceModelStatus,
  VoicePermissionState,
  VoiceWorkerRpcRequest,
  VoiceWorkerRpcResponse,
} from './voice-types';
import { VOICE_MAX_APPEND_CHUNK_BYTES } from './voice-types';

describe('voice shared types', () => {
  it('pins the persisted dictation config shape', () => {
    expectTypeOf<VoiceDictationConfig>().toEqualTypeOf<{
      readonly enabled: boolean;
      readonly inputDeviceId: string | null;
      readonly shortcut: string;
      readonly pushToTalk: boolean;
      readonly model: {
        readonly id: 'nemotron-speech-streaming-en-0.6b';
        readonly downloadedAt?: string;
      };
    }>();
  });

  it('describes model status and microphone permission states', () => {
    expectTypeOf<VoiceDictationConfig['model']>().toEqualTypeOf<VoiceDictationModelConfig>();
    expectTypeOf<VoiceModelStatus>().toMatchTypeOf<{
      readonly id: 'nemotron-speech-streaming-en-0.6b';
      readonly status: 'not-downloaded' | 'downloading' | 'ready' | 'error';
    }>();
    expectTypeOf<'granted'>().toMatchTypeOf<VoicePermissionState>();
    expectTypeOf<'unsupported'>().toMatchTypeOf<VoicePermissionState>();
    expectTypeOf<'prompt'>().not.toMatchTypeOf<VoicePermissionState>();
    expect(VOICE_MAX_APPEND_CHUNK_BYTES).toBe(64 * 1024);
  });

  it('uses discriminated transcript events', () => {
    expectTypeOf<{ type: 'partial'; sessionId: string; text: string }>().toMatchTypeOf<TranscriptionEvent>();
    expectTypeOf<{ type: 'final'; sessionId: string; text: string; isFinal: true }>().toMatchTypeOf<TranscriptionEvent>();
    expectTypeOf<{ type: 'error'; sessionId: string; message: string }>().toMatchTypeOf<TranscriptionEvent>();
    expectTypeOf<{ type: 'sessionStarted'; sessionId: string }>().toMatchTypeOf<TranscriptionEvent>();
    expectTypeOf<{ type: 'sessionEnded'; sessionId: string }>().toMatchTypeOf<TranscriptionEvent>();
    expectTypeOf<{ type: 'partial'; text: string }>().not.toMatchTypeOf<TranscriptionEvent>();
    expectTypeOf<{ type: 'partial'; message: string }>().not.toMatchTypeOf<TranscriptionEvent>();
  });

  it('covers all worker RPC verbs', () => {
    expectTypeOf<VoiceWorkerRpcRequest['verb']>().toEqualTypeOf<
      | 'setEnabled'
      | 'selectModel'
      | 'downloadModel'
      | 'deleteModel'
      | 'installRuntime'
      | 'refresh'
      | 'start'
      | 'append'
      | 'end'
    >();
    expectTypeOf<{ requestId: string; verb: 'append'; sessionId: string; pcm: Uint8Array }>().toMatchTypeOf<VoiceWorkerRpcRequest>();
    expectTypeOf<{ requestId: string; verb: 'end'; sessionId: string }>().toMatchTypeOf<VoiceWorkerRpcRequest>();
    expectTypeOf<{ requestId: string; verb: 'downloadModel'; ok: true }>().toMatchTypeOf<VoiceWorkerRpcResponse>();
    expectTypeOf<{ requestId: string; verb: 'refresh'; ok: false; error: string }>().toMatchTypeOf<VoiceWorkerRpcResponse>();
  });
});
