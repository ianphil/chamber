export const VOICE_DICTATION_MODEL_ID = 'nemotron-speech-streaming-en-0.6b' as const;
export const VOICE_MAX_APPEND_CHUNK_BYTES = 64 * 1024;

export type VoiceDictationModelId = typeof VOICE_DICTATION_MODEL_ID;

export type VoicePermissionState =
  | 'granted'
  | 'denied'
  | 'not-determined'
  | 'restricted'
  | 'unsupported';

export type VoiceModelLifecycleStatus = 'not-downloaded' | 'downloading' | 'ready' | 'error';

export interface VoiceModelStatus {
  readonly id: VoiceDictationModelId;
  readonly status: VoiceModelLifecycleStatus;
  readonly percent?: number;
  readonly sizeBytes?: number;
  readonly downloadedAt?: string;
  readonly errorMessage?: string;
}

export interface VoiceDictationModelConfig {
  readonly id: VoiceDictationModelId;
  readonly downloadedAt?: string;
}

export interface VoiceDictationConfig {
  readonly enabled: boolean;
  readonly inputDeviceId: string | null;
  readonly shortcut: string;
  readonly pushToTalk: boolean;
  readonly model: VoiceDictationModelConfig;
}

export type TranscriptionEvent =
  | { readonly type: 'partial'; readonly sessionId: string; readonly text: string; readonly isFinal?: false }
  | { readonly type: 'final'; readonly sessionId: string; readonly text: string; readonly isFinal?: true }
  | { readonly type: 'error'; readonly sessionId: string; readonly message: string }
  | { readonly type: 'sessionStarted'; readonly sessionId: string }
  | { readonly type: 'sessionEnded'; readonly sessionId: string };

export type VoiceWorkerRpcVerb =
  | 'setEnabled'
  | 'selectModel'
  | 'downloadModel'
  | 'deleteModel'
  | 'installRuntime'
  | 'refresh'
  | 'start'
  | 'append'
  | 'end';

interface VoiceWorkerRpcRequestBase {
  readonly requestId: string;
}

export type VoiceWorkerRpcRequest =
  | (VoiceWorkerRpcRequestBase & { readonly verb: 'setEnabled'; readonly enabled: boolean })
  | (VoiceWorkerRpcRequestBase & { readonly verb: 'selectModel'; readonly modelId: string })
  | (VoiceWorkerRpcRequestBase & { readonly verb: 'downloadModel'; readonly modelId: string })
  | (VoiceWorkerRpcRequestBase & { readonly verb: 'deleteModel'; readonly modelId: string })
  | (VoiceWorkerRpcRequestBase & { readonly verb: 'installRuntime' })
  | (VoiceWorkerRpcRequestBase & { readonly verb: 'refresh' })
  | (VoiceWorkerRpcRequestBase & { readonly verb: 'start'; readonly sessionId: string; readonly modelId: string })
  | (VoiceWorkerRpcRequestBase & { readonly verb: 'append'; readonly sessionId: string; readonly pcm: Uint8Array })
  | (VoiceWorkerRpcRequestBase & { readonly verb: 'end'; readonly sessionId: string });

interface VoiceWorkerRpcResponseBase {
  readonly requestId: string;
  readonly verb: VoiceWorkerRpcVerb;
}

export type VoiceWorkerRpcResponse =
  | (VoiceWorkerRpcResponseBase & { readonly ok: true; readonly status?: VoiceModelStatus; readonly statuses?: VoiceModelStatus[] })
  | (VoiceWorkerRpcResponseBase & { readonly ok: false; readonly error: string });

export type VoiceInstallerEvent =
  | {
    readonly type: 'modelProgress';
    readonly modelId: VoiceDictationModelId;
    readonly percent: number;
    readonly sizeBytes?: number;
  };

export type VoiceMicTestResult =
  | { readonly success: true; readonly transcript?: string }
  | { readonly success: false; readonly error: string };
