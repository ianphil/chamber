import type { TranscriptionEvent, VoiceModelStatus } from '@chamber/shared/voice-types';

export interface TranscriptionProviderStartOptions {
  readonly sessionId: string;
  readonly signal?: AbortSignal;
}

export interface TranscriptionProvider {
  start(opts?: TranscriptionProviderStartOptions): Promise<void>;
  append(pcm: Uint8Array): Promise<void>;
  end(): Promise<void>;
  onEvent(cb: (event: TranscriptionEvent) => void): () => void;
}

export interface TranscriptionProviderFactory {
  create(modelId: string): Promise<TranscriptionProvider>;
  getModelStatus(modelId: string): Promise<VoiceModelStatus>;
  downloadModel(modelId: string, progressCb: (status: VoiceModelStatus) => void): Promise<void>;
  cancelDownload(modelId: string): Promise<void>;
}
