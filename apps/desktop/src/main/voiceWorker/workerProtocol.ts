export type {
  TranscriptionEvent,
  VoiceWorkerRpcRequest,
  VoiceWorkerRpcResponse,
} from '@chamber/shared/voice-types';

/**
 * Chamber keeps the renderer/main RPC verb named `end` so UI and service code
 * have a provider-neutral session lifecycle. The Foundry Local engine worker
 * implementation maps that verb to `LiveAudioTranscriptionSession.stop()`
 * followed by `dispose()` because the SDK does not expose an `end()` method.
 *
 * `cancelDownload` is intentionally not a worker RPC verb in Phase A. Foundry's
 * model download API has no abort handle, so Phase B cancels downloads by
 * terminating and replacing the installer worker.
 */
export const VOICE_WORKER_PROTOCOL_NOTES = 'voice-worker-protocol-notes';
