import { describe, expect, it, vi, beforeEach } from 'vitest';

import type { VoiceWorkerRpcResponse } from '@chamber/shared/voice-types';

const foundry = vi.hoisted(() => ({
  createAsync: vi.fn(),
}));

vi.mock('foundry-local-sdk', () => ({
  FoundryLocalManager: {
    createAsync: foundry.createAsync,
  },
}));

interface TestPort {
  messages: unknown[];
  postMessage(message: unknown): void;
}

function createPort(): TestPort {
  return {
    messages: [],
    postMessage(message) {
      this.messages.push(message);
    },
  };
}

function findRecord(messages: unknown[], predicate: (message: Record<string, unknown>) => boolean): Record<string, unknown> | undefined {
  return messages.find((message): message is Record<string, unknown> => (
    typeof message === 'object'
    && message !== null
    && !Array.isArray(message)
    && predicate(message as Record<string, unknown>)
  ));
}

function createModel(sessionOrSessions: Record<string, unknown> | Record<string, unknown>[]) {
  const sessions = Array.isArray(sessionOrSessions) ? [...sessionOrSessions] : [sessionOrSessions];
  return {
    alias: 'nemotron-speech-streaming-en-0.6b',
    info: { fileSizeMb: 12, sizeInBytes: 13 * 1024 * 1024 },
    isCached: true,
    load: vi.fn(async () => undefined),
    download: vi.fn(async (onProgress?: (progress: number) => void) => {
      onProgress?.(50);
      onProgress?.(100);
    }),
    removeFromCache: vi.fn(),
    createAudioClient: vi.fn(() => ({
      createLiveTranscriptionSession: vi.fn(() => sessions.shift() ?? sessionOrSessions),
    })),
  };
}

async function importWorker() {
  vi.resetModules();
  return import('./voiceWorker');
}

describe('voiceWorker', () => {
  beforeEach(() => {
    foundry.createAsync.mockReset();
  });

  it('selects and loads a Foundry model', async () => {
    const session = {};
    const model = createModel(session);
    const manager = { catalog: { getModel: vi.fn(async () => model) } };
    foundry.createAsync.mockResolvedValue(manager);
    const port = createPort();
    const { handleVoiceWorkerRequest } = await importWorker();

    await handleVoiceWorkerRequest({ requestId: 'select-1', verb: 'selectModel', modelId: 'nemotron-speech-streaming-en-0.6b' }, port);

    expect(foundry.createAsync).toHaveBeenCalledWith({ appName: 'Chamber', logLevel: 'info' });
    expect(manager.catalog.getModel).toHaveBeenCalledWith('nemotron-speech-streaming-en-0.6b');
    expect(model.load).toHaveBeenCalledTimes(1);
    expect(port.messages).toEqual([
      {
        requestId: 'select-1',
        verb: 'selectModel',
        ok: true,
        status: {
          id: 'nemotron-speech-streaming-en-0.6b',
          status: 'ready',
          sizeBytes: 13 * 1024 * 1024,
          downloadedAt: expect.any(String),
        },
      },
    ]);
  });

  it('downloads a model and posts progress events from the same Foundry manager', async () => {
    const session = {};
    const model = createModel(session);
    const manager = { catalog: { getModel: vi.fn(async () => model) } };
    foundry.createAsync.mockResolvedValue(manager);
    const port = createPort();
    const { handleVoiceWorkerRequest } = await importWorker();

    await handleVoiceWorkerRequest({
      requestId: 'download-1',
      verb: 'downloadModel',
      modelId: 'nemotron-speech-streaming-en-0.6b',
    }, port);

    expect(foundry.createAsync).toHaveBeenCalledTimes(1);
    expect(model.download).toHaveBeenCalledWith(expect.any(Function));
    expect(port.messages).toEqual([
      { type: 'modelProgress', modelId: 'nemotron-speech-streaming-en-0.6b', percent: 50, sizeBytes: 13 * 1024 * 1024 },
      { type: 'modelProgress', modelId: 'nemotron-speech-streaming-en-0.6b', percent: 100, sizeBytes: 13 * 1024 * 1024 },
      {
        requestId: 'download-1',
        verb: 'downloadModel',
        ok: true,
        status: expect.objectContaining({
          id: 'nemotron-speech-streaming-en-0.6b',
          status: 'ready',
          sizeBytes: 13 * 1024 * 1024,
        }),
      },
    ]);
  });

  it('returns cached model status on refresh even before download starts', async () => {
    const session = {};
    const model = createModel(session);
    const manager = { catalog: { getModel: vi.fn(async () => model) } };
    foundry.createAsync.mockResolvedValue(manager);
    const port = createPort();
    const { handleVoiceWorkerRequest } = await importWorker();

    await handleVoiceWorkerRequest({ requestId: 'refresh-1', verb: 'refresh' }, port);

    expect(manager.catalog.getModel).toHaveBeenCalledWith('nemotron-speech-streaming-en-0.6b');
    expect(port.messages).toEqual([
      {
        requestId: 'refresh-1',
        verb: 'refresh',
        ok: true,
        status: expect.objectContaining({
          id: 'nemotron-speech-streaming-en-0.6b',
          status: 'ready',
          sizeBytes: 13 * 1024 * 1024,
        }),
        statuses: [
          expect.objectContaining({
            id: 'nemotron-speech-streaming-en-0.6b',
            status: 'ready',
            sizeBytes: 13 * 1024 * 1024,
          }),
        ],
      },
    ]);
  });

  it('starts live transcription with 16 kHz mono PCM16 settings and posts transcript events', async () => {
    async function* stream() {
      yield { is_final: false, content: [{ text: 'hello' }] };
      yield { is_final: true, content: [{ transcript: 'hello chamber' }] };
    }
    const session = {
      settings: {},
      start: vi.fn(async () => undefined),
      append: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
      getStream: vi.fn(() => stream()),
    };
    const model = createModel(session);
    const manager = { catalog: { getModel: vi.fn(async () => model) } };
    foundry.createAsync.mockResolvedValue(manager);
    const port = createPort();
    const { handleVoiceWorkerRequest } = await importWorker();

    await handleVoiceWorkerRequest({
      requestId: 'start-1',
      verb: 'start',
      sessionId: 'session-1',
      modelId: 'nemotron-speech-streaming-en-0.6b',
    }, port);
    await Promise.resolve();
    await Promise.resolve();

    expect(session.settings).toEqual({ sampleRate: 16_000, channels: 1, bitsPerSample: 16 });
    expect(session.start).toHaveBeenCalledTimes(1);
    expect(findRecord(port.messages, (message) => message.type === 'sessionStarted')).toMatchObject({ sessionId: 'session-1' });
    expect(findRecord(port.messages, (message) => message.type === 'partial')).toMatchObject({ sessionId: 'session-1', text: 'hello' });
    expect(findRecord(port.messages, (message) => message.type === 'final')).toMatchObject({
      sessionId: 'session-1',
      text: 'hello chamber',
      isFinal: true,
    });
    expect(findRecord(port.messages, (message) => message.requestId === 'start-1')).toMatchObject({ verb: 'start', ok: true });
  });

  it('clears worker session state when Foundry start fails before retrying later', async () => {
    async function* stream() {
      yield* [];
    }
    const failedSession = {
      settings: {},
      start: vi.fn(async () => {
        throw new Error('microphone unavailable');
      }),
      dispose: vi.fn(async () => undefined),
      getStream: vi.fn(() => stream()),
    };
    const retrySession = {
      settings: {},
      start: vi.fn(async () => undefined),
      append: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
      getStream: vi.fn(() => stream()),
    };
    const model = createModel([failedSession, retrySession]);
    const manager = { catalog: { getModel: vi.fn(async () => model) } };
    foundry.createAsync.mockResolvedValue(manager);
    const port = createPort();
    const { handleVoiceWorkerRequest } = await importWorker();

    await handleVoiceWorkerRequest({
      requestId: 'start-1',
      verb: 'start',
      sessionId: 'session-1',
      modelId: 'nemotron-speech-streaming-en-0.6b',
    }, port);
    await handleVoiceWorkerRequest({
      requestId: 'start-2',
      verb: 'start',
      sessionId: 'session-2',
      modelId: 'nemotron-speech-streaming-en-0.6b',
    }, port);

    expect(failedSession.dispose).toHaveBeenCalledTimes(1);
    expect(port.messages).toContainEqual({
      type: 'error',
      sessionId: 'session-1',
      message: 'microphone unavailable',
    });
    expect(port.messages).toContainEqual({ requestId: 'start-1', verb: 'start', ok: false, error: 'microphone unavailable' });
    expect(port.messages).toContainEqual({ type: 'sessionStarted', sessionId: 'session-2' });
    expect(port.messages).toContainEqual({ requestId: 'start-2', verb: 'start', ok: true });
  });

  it('stops an orphan Foundry audio stream handle and retries start once', async () => {
    async function* stream() {
      yield* [];
    }
    const failedSession = {
      settings: {},
      start: vi.fn(async () => {
        throw new Error("Command 'audio_stream_start' failed: System.InvalidOperationException: A streaming session is already active (handle: audio-stream-a1ea6402619b400fb28f2f7e372021b6). Stop the current session before starting a new one.");
      }),
      dispose: vi.fn(async () => undefined),
      getStream: vi.fn(() => stream()),
    };
    const cleanupSession = {
      settings: {},
      stop: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
      getStream: vi.fn(() => stream()),
    };
    const retrySession = {
      settings: {},
      start: vi.fn(async () => undefined),
      append: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
      getStream: vi.fn(() => stream()),
    };
    const model = createModel([failedSession, cleanupSession, retrySession]);
    const manager = { catalog: { getModel: vi.fn(async () => model) } };
    foundry.createAsync.mockResolvedValue(manager);
    const port = createPort();
    const { handleVoiceWorkerRequest } = await importWorker();

    await handleVoiceWorkerRequest({
      requestId: 'start-1',
      verb: 'start',
      sessionId: 'session-1',
      modelId: 'nemotron-speech-streaming-en-0.6b',
    }, port);

    expect(failedSession.dispose).toHaveBeenCalledTimes(1);
    expect(cleanupSession.stop).toHaveBeenCalledTimes(1);
    expect(cleanupSession).toMatchObject({
      sessionHandle: 'audio-stream-a1ea6402619b400fb28f2f7e372021b6',
      started: true,
      stopped: false,
    });
    expect(retrySession.start).toHaveBeenCalledTimes(1);
    expect(port.messages).toContainEqual({ type: 'sessionStarted', sessionId: 'session-1' });
    expect(port.messages).toContainEqual({ requestId: 'start-1', verb: 'start', ok: true });
  });

  it('appends PCM data and maps end to stop plus dispose', async () => {
    async function* stream() {
      yield* [];
    }
    const pcm = new Uint8Array([1, 2, 3]);
    const session = {
      settings: {},
      start: vi.fn(async () => undefined),
      append: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
      end: vi.fn(async () => undefined),
      getStream: vi.fn(() => stream()),
    };
    const model = createModel(session);
    const manager = { catalog: { getModel: vi.fn(async () => model) } };
    foundry.createAsync.mockResolvedValue(manager);
    const port = createPort();
    const { handleVoiceWorkerRequest } = await importWorker();

    await handleVoiceWorkerRequest({
      requestId: 'start-1',
      verb: 'start',
      sessionId: 'session-1',
      modelId: 'nemotron-speech-streaming-en-0.6b',
    }, port);
    await handleVoiceWorkerRequest({ requestId: 'append-1', verb: 'append', sessionId: 'session-1', pcm }, port);
    await handleVoiceWorkerRequest({ requestId: 'end-1', verb: 'end', sessionId: 'session-1' }, port);

    expect(session.append).toHaveBeenCalledWith(pcm);
    expect(session.stop).toHaveBeenCalledTimes(1);
    expect(session.dispose).toHaveBeenCalledTimes(1);
    expect(session.end).not.toHaveBeenCalled();
    expect(port.messages).toContainEqual({ type: 'sessionEnded', sessionId: 'session-1' });
    expect(port.messages).toContainEqual({ requestId: 'end-1', verb: 'end', ok: true });
  });

  it('returns RPC errors for stale session appends', async () => {
    const port = createPort();
    const { handleVoiceWorkerRequest } = await importWorker();

    await handleVoiceWorkerRequest({ requestId: 'append-1', verb: 'append', sessionId: 'missing-session', pcm: new Uint8Array() }, port);

    expect(port.messages).toContainEqual({
      type: 'error',
      sessionId: 'missing-session',
      message: 'No active voice engine session',
    });
    expect(port.messages).toContainEqual({
      requestId: 'append-1',
      verb: 'append',
      ok: false,
      error: 'No active voice engine session',
    } satisfies VoiceWorkerRpcResponse);
  });
});
