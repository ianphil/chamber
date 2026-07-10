export type {
  VoiceInstallerEvent,
  TranscriptionEvent,
  VoiceWorkerRpcRequest,
  VoiceWorkerRpcResponse,
} from '@chamber/shared/voice-types';
import type {
  TranscriptionEvent,
  VoiceInstallerEvent,
  VoiceWorkerRpcRequest,
  VoiceWorkerRpcResponse,
} from '@chamber/shared/voice-types';
import { getErrorMessage } from '@chamber/shared/getErrorMessage';

/**
 * Chamber keeps the renderer/main RPC verb named `end` so UI and service code
 * have a provider-neutral session lifecycle. The Foundry Local engine worker
 * implementation maps that verb to `LiveAudioTranscriptionSession.stop()`
 * followed by `dispose()` because the SDK does not expose an `end()` method.
 *
 * `cancelDownload` is intentionally not a worker RPC verb. Foundry's model
 * download API has no abort handle, so Chamber cancels downloads by terminating
 * and replacing the single voice worker.
 */
export const VOICE_WORKER_PROTOCOL_NOTES = 'voice-worker-protocol-notes';

export interface VoiceWorkerPort {
  postMessage(message: VoiceWorkerRpcResponse | TranscriptionEvent | VoiceInstallerEvent): void;
}

export function isVoiceWorkerRpcRequest(message: unknown): message is VoiceWorkerRpcRequest {
  if (!isRecord(message)) return false;
  return typeof message.requestId === 'string' && typeof message.verb === 'string';
}

export function postWorkerSuccess(
  port: VoiceWorkerPort,
  request: VoiceWorkerRpcRequest,
  payload: Partial<Extract<VoiceWorkerRpcResponse, { readonly ok: true }>> = {},
): void {
  port.postMessage({
    requestId: request.requestId,
    verb: request.verb,
    ok: true,
    ...payload,
  });
}

export function postWorkerError(port: VoiceWorkerPort, request: VoiceWorkerRpcRequest, err: unknown): void {
  port.postMessage({
    requestId: request.requestId,
    verb: request.verb,
    ok: false,
    error: getErrorMessage(err),
  });
}

export function postTranscriptionEvent(port: VoiceWorkerPort, event: TranscriptionEvent): void {
  port.postMessage(event);
}

export function postInstallerEvent(port: VoiceWorkerPort, event: VoiceInstallerEvent): void {
  port.postMessage(event);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
