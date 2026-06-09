import { parentPort } from 'node:worker_threads';

import {
  FoundryLocalManager,
  type AudioClient,
  type IModel,
  type LiveAudioTranscriptionResponse,
  type LiveAudioTranscriptionSession,
} from 'foundry-local-sdk';
import type { TranscriptionEvent, VoiceModelStatus, VoiceWorkerRpcRequest } from '@chamber/shared/voice-types';
import { getErrorMessage } from '@chamber/shared/getErrorMessage';
import {
  isVoiceWorkerRpcRequest,
  postTranscriptionEvent,
  postWorkerError,
  postWorkerSuccess,
  type VoiceWorkerPort,
} from './workerProtocol';

interface FoundryEngineWorkerState {
  manager: FoundryLocalManager | null;
  model: IModel | null;
  modelId: string | null;
  session: LiveAudioTranscriptionSession | null;
  sessionId: string | null;
  streamLoop: Promise<void> | null;
}

const state: FoundryEngineWorkerState = {
  manager: null,
  model: null,
  modelId: null,
  session: null,
  sessionId: null,
  streamLoop: null,
};

export function bindEngineWorker(port: VoiceWorkerPort): void {
  const maybeParentPort = port as VoiceWorkerPort & { on?: (event: 'message', listener: (message: unknown) => void) => void };
  maybeParentPort.on?.('message', (message: unknown) => {
    if (!isVoiceWorkerRpcRequest(message)) return;
    void handleEngineRequest(message, port);
  });
}

export async function handleEngineRequest(request: VoiceWorkerRpcRequest, port: VoiceWorkerPort): Promise<void> {
  try {
    switch (request.verb) {
      case 'setEnabled':
        postWorkerSuccess(port, request);
        return;
      case 'selectModel': {
        const model = await selectModel(request.modelId);
        postWorkerSuccess(port, request, { status: toModelStatus(model) });
        return;
      }
      case 'refresh': {
        postWorkerSuccess(port, request, {
          ...(state.model ? { status: toModelStatus(state.model) } : {}),
        });
        return;
      }
      case 'start':
        await startSession(request.sessionId, request.modelId, port);
        postWorkerSuccess(port, request);
        return;
      case 'append':
        await appendAudio(request.sessionId, request.pcm);
        postWorkerSuccess(port, request);
        return;
      case 'end':
        await endSession(request.sessionId, port);
        postWorkerSuccess(port, request);
        return;
      default:
        throw new Error(`Unsupported voice engine worker verb: ${request.verb}`);
    }
  } catch (err) {
    if ('sessionId' in request && typeof request.sessionId === 'string') {
      postTranscriptionEvent(port, { type: 'error', sessionId: request.sessionId, message: getErrorMessage(err) });
    }
    postWorkerError(port, request, err);
  }
}

async function getManager(): Promise<FoundryLocalManager> {
  if (!state.manager) {
    state.manager = await FoundryLocalManager.createAsync({ appName: 'Chamber', logLevel: 'info' });
  }
  if (!state.manager) {
    throw new Error('Foundry Local manager failed to initialize');
  }
  return state.manager;
}

async function selectModel(modelId: string): Promise<IModel> {
  const manager = await getManager();
  const model = await manager.catalog.getModel(modelId);
  await model.load();
  state.model = model;
  state.modelId = modelId;
  return model;
}

async function startSession(sessionId: string, modelId: string, port: VoiceWorkerPort): Promise<void> {
  if (state.session) {
    throw new Error(`Voice engine session ${state.sessionId ?? '<unknown>'} is already active`);
  }

  const model = state.modelId === modelId && state.model ? state.model : await selectModel(modelId);
  const audioClient = createAudioClient(model);
  const session = audioClient.createLiveTranscriptionSession();
  session.settings.sampleRate = 16_000;
  session.settings.channels = 1;
  session.settings.bitsPerSample = 16;
  state.session = session;
  state.sessionId = sessionId;
  await session.start();
  postTranscriptionEvent(port, { type: 'sessionStarted', sessionId });
  state.streamLoop = streamTranscriptionEvents(session, sessionId, port);
}

function createAudioClient(model: IModel): AudioClient {
  return model.createAudioClient();
}

async function appendAudio(sessionId: string, pcm: Uint8Array): Promise<void> {
  const session = requireActiveSession(sessionId);
  await session.append(pcm);
}

async function endSession(sessionId: string, port: VoiceWorkerPort): Promise<void> {
  const session = requireActiveSession(sessionId);
  state.session = null;
  state.sessionId = null;
  try {
    await session.stop();
  } finally {
    await session.dispose();
  }
  await state.streamLoop;
  state.streamLoop = null;
  postTranscriptionEvent(port, { type: 'sessionEnded', sessionId });
}

function requireActiveSession(sessionId: string): LiveAudioTranscriptionSession {
  if (!state.session || !state.sessionId) {
    throw new Error('No active voice engine session');
  }
  if (state.sessionId !== sessionId) {
    throw new Error(`Ignoring stale voice engine session ${sessionId}`);
  }
  return state.session;
}

async function streamTranscriptionEvents(
  session: LiveAudioTranscriptionSession,
  sessionId: string,
  port: VoiceWorkerPort,
): Promise<void> {
  try {
    for await (const result of session.getStream()) {
      const text = getTranscriptionText(result);
      if (!text) continue;
      if (result.is_final) {
        const event: TranscriptionEvent = { type: 'final', sessionId, text, isFinal: true };
        postTranscriptionEvent(port, event);
      } else {
        const event: TranscriptionEvent = { type: 'partial', sessionId, text };
        postTranscriptionEvent(port, event);
      }
    }
  } catch (err) {
    postTranscriptionEvent(port, { type: 'error', sessionId, message: getErrorMessage(err) });
  }
}

function getTranscriptionText(result: LiveAudioTranscriptionResponse): string {
  return result.content
    .map((part) => part.text ?? part.transcript ?? '')
    .join('')
    .trim();
}

function toModelStatus(model: IModel): VoiceModelStatus {
  return {
    id: model.alias as VoiceModelStatus['id'],
    status: model.isCached ? 'ready' : 'not-downloaded',
    ...(typeof model.info.fileSizeMb === 'number' ? { sizeBytes: Math.round(model.info.fileSizeMb * 1024 * 1024) } : {}),
  };
}

if (parentPort) {
  bindEngineWorker(parentPort);
}
