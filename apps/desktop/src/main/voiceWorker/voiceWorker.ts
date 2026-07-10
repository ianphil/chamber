import { pathToFileURL } from 'node:url';
import { parentPort, workerData } from 'node:worker_threads';

import type {
  AudioClient,
  FoundryLocalManager,
  IModel,
  LiveAudioTranscriptionResponse,
  LiveAudioTranscriptionSession,
} from 'foundry-local-sdk';
import {
  VOICE_DICTATION_MODEL_ID,
  type TranscriptionEvent,
  type VoiceModelStatus,
  type VoiceWorkerRpcRequest,
} from '@chamber/shared/voice-types';
import { getErrorMessage } from '@chamber/shared/getErrorMessage';
import {
  isVoiceWorkerRpcRequest,
  postInstallerEvent,
  postTranscriptionEvent,
  postWorkerError,
  postWorkerSuccess,
  type VoiceWorkerPort,
} from './workerProtocol';

interface FoundryVoiceWorkerState {
  manager: FoundryLocalManager | null;
  managerPromise: Promise<FoundryLocalManager> | null;
  model: IModel | null;
  modelId: string | null;
  session: LiveAudioTranscriptionSession | null;
  sessionId: string | null;
  streamLoop: Promise<void> | null;
}

type FoundrySdk = Pick<typeof import('foundry-local-sdk'), 'FoundryLocalManager'>;

const state: FoundryVoiceWorkerState = {
  manager: null,
  managerPromise: null,
  model: null,
  modelId: null,
  session: null,
  sessionId: null,
  streamLoop: null,
};
let foundrySdkPromise: Promise<FoundrySdk> | null = null;

export function bindVoiceWorker(port: VoiceWorkerPort): void {
  const maybeParentPort = port as VoiceWorkerPort & { on?: (event: 'message', listener: (message: unknown) => void) => void };
  let requestQueue = Promise.resolve();
  maybeParentPort.on?.('message', (message: unknown) => {
    if (!isVoiceWorkerRpcRequest(message)) return;
    requestQueue = requestQueue
      .then(() => handleVoiceWorkerRequest(message, port))
      .catch(() => undefined);
  });
}

export async function handleVoiceWorkerRequest(request: VoiceWorkerRpcRequest, port: VoiceWorkerPort): Promise<void> {
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
      case 'downloadModel': {
        const status = await downloadModel(request.modelId, port, request.forceRedownload === true);
        postWorkerSuccess(port, request, { status });
        return;
      }
      case 'installRuntime':
        await installRuntime();
        postWorkerSuccess(port, request);
        return;
      case 'deleteModel': {
        const status = await deleteModel(request.modelId);
        postWorkerSuccess(port, request, { status });
        return;
      }
      case 'refresh': {
        const status = await refreshModelStatus();
        postWorkerSuccess(port, request, { status, statuses: [status] });
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
    }
  } catch (err) {
    if ('sessionId' in request && typeof request.sessionId === 'string') {
      postTranscriptionEvent(port, { type: 'error', sessionId: request.sessionId, message: getErrorMessage(err) });
    }
    postWorkerError(port, request, err);
  }
}

async function getManager(): Promise<FoundryLocalManager> {
  if (state.manager) return state.manager;
  const { FoundryLocalManager } = await loadFoundrySdk();
  state.managerPromise ??= FoundryLocalManager.createAsync({ appName: 'Chamber', logLevel: 'info' })
    .then((manager) => {
      state.manager = manager;
      return manager;
    })
    .catch((err: unknown) => {
      state.managerPromise = null;
      throw err;
    });
  return state.managerPromise;
}

function loadFoundrySdk(): Promise<FoundrySdk> {
  if (foundrySdkPromise) return foundrySdkPromise;
  const sdkEntry = getVoiceSdkEntry();
  foundrySdkPromise = sdkEntry
    ? import(/* @vite-ignore */ pathToFileURL(sdkEntry).href) as Promise<FoundrySdk>
    : import('foundry-local-sdk');
  return foundrySdkPromise;
}

function getVoiceSdkEntry(): string | null {
  if (typeof workerData !== 'object' || workerData === null || Array.isArray(workerData)) return null;
  const entry = (workerData as Record<string, unknown>).voiceSdkEntry;
  return typeof entry === 'string' && entry.length > 0 ? entry : null;
}

async function selectModel(modelId: string): Promise<IModel> {
  const model = await getModel(modelId);
  if (!model.isCached) {
    throw new Error('Download the voice dictation model before testing the microphone.');
  }
  await model.load();
  state.model = model;
  state.modelId = modelId;
  return model;
}

async function downloadModel(modelId: string, port: VoiceWorkerPort, forceRedownload = false): Promise<VoiceModelStatus> {
  const model = await getModel(modelId);
  if (forceRedownload) {
    await model.removeFromCache();
  }
  await model.download((progress) => {
    postInstallerEvent(port, {
      type: 'modelProgress',
      modelId: model.alias as VoiceModelStatus['id'],
      percent: clampPercent(progress),
      ...optionalSizeBytes(model),
    });
  });
  return toModelStatus(model, 'ready');
}

async function installRuntime(): Promise<void> {
  const manager = await getManager();
  await manager.downloadAndRegisterEps(() => {
    // EP progress remains internal; model download progress is surfaced.
  });
}

async function deleteModel(modelId: string): Promise<VoiceModelStatus> {
  const model = await getModel(modelId);
  model.removeFromCache();
  if (state.modelId === modelId) {
    state.model = null;
    state.modelId = null;
  }
  return toModelStatus(model, 'not-downloaded');
}

async function refreshModelStatus(): Promise<VoiceModelStatus> {
  const model = await getModel(VOICE_DICTATION_MODEL_ID);
  return toModelStatus(model, model.isCached ? 'ready' : 'not-downloaded');
}

async function getModel(modelId: string): Promise<IModel> {
  const manager = await getManager();
  return manager.catalog.getModel(modelId);
}

async function startSession(sessionId: string, modelId: string, port: VoiceWorkerPort): Promise<void> {
  if (state.session) {
    throw new Error(`Voice engine session ${state.sessionId ?? '<unknown>'} is already active`);
  }

  const model = state.modelId === modelId && state.model ? state.model : await selectModel(modelId);
  const session = await openLiveSession(model);
  state.session = session;
  state.sessionId = sessionId;
  postTranscriptionEvent(port, { type: 'sessionStarted', sessionId });
  state.streamLoop = streamTranscriptionEvents(session, sessionId, port);
}

function createAudioClient(model: IModel): AudioClient {
  return model.createAudioClient();
}

async function openLiveSession(model: IModel): Promise<LiveAudioTranscriptionSession> {
  const session = createConfiguredLiveSession(model);
  try {
    await session.start();
    return session;
  } catch (err) {
    await session.dispose().catch(() => undefined);
    const staleHandle = parseAlreadyActiveAudioStreamHandle(err);
    if (!staleHandle) throw err;

    await recoverFoundryAudioStream(model, staleHandle);
    const retrySession = createConfiguredLiveSession(model);
    try {
      await retrySession.start();
      return retrySession;
    } catch (retryErr) {
      await retrySession.dispose().catch(() => undefined);
      throw new Error(
        `Failed to start voice dictation after clearing stale Foundry audio stream ${staleHandle}: ${getErrorMessage(retryErr)}`,
        { cause: retryErr },
      );
    }
  }
}

function createConfiguredLiveSession(model: IModel): LiveAudioTranscriptionSession {
  const audioClient = createAudioClient(model);
  const session = audioClient.createLiveTranscriptionSession();
  session.settings.sampleRate = 16_000;
  session.settings.channels = 1;
  session.settings.bitsPerSample = 16;
  return session;
}

async function recoverFoundryAudioStream(model: IModel, sessionHandle: string): Promise<void> {
  const cleanupSession = createConfiguredLiveSession(model);
  const recoverableSession = cleanupSession as unknown as {
    sessionHandle: string;
    started: boolean;
    stopped: boolean;
    stop(): Promise<void>;
    dispose(): Promise<void>;
  };
  recoverableSession.sessionHandle = sessionHandle;
  recoverableSession.started = true;
  recoverableSession.stopped = false;
  await recoverableSession.stop().catch(() => undefined);
  await recoverableSession.dispose().catch(() => undefined);
}

function parseAlreadyActiveAudioStreamHandle(err: unknown): string | null {
  const message = getErrorMessage(err);
  if (!/streaming session is already active/i.test(message)) return null;
  const match = /\(handle:\s*(audio-stream-[^)]+)\)/i.exec(message);
  return match?.[1] ?? null;
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

function toModelStatus(model: IModel, status: VoiceModelStatus['status'] = model.isCached ? 'ready' : 'not-downloaded'): VoiceModelStatus {
  return {
    id: model.alias as VoiceModelStatus['id'],
    status,
    ...optionalSizeBytes(model),
    ...(status === 'ready' ? { downloadedAt: new Date().toISOString() } : {}),
  };
}

function optionalSizeBytes(model: IModel): Pick<VoiceModelStatus, 'sizeBytes'> {
  const sizeBytes = getModelSizeBytes(model);
  return sizeBytes === undefined ? {} : { sizeBytes };
}

function getModelSizeBytes(model: IModel): number | undefined {
  const info = model.info as unknown as Record<string, unknown>;
  const direct = firstFiniteNumber(info.sizeInBytes, info.sizeBytes, info.fileSizeBytes, info.bytes);
  if (direct !== undefined && direct > 0) return Math.round(direct);
  const fileSizeMb = firstFiniteNumber(info.fileSizeMb);
  if (fileSizeMb !== undefined && fileSizeMb > 0) return Math.round(fileSizeMb * 1024 * 1024);
  return undefined;
}

function firstFiniteNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

function clampPercent(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(100, Math.round(progress)));
}

if (parentPort) {
  bindVoiceWorker(parentPort);
}
