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

function createModel(session: Record<string, unknown>) {
  return {
    alias: 'nemotron-speech-streaming-en-0.6b',
    info: { fileSizeMb: 12 },
    isCached: true,
    load: vi.fn(async () => undefined),
    createAudioClient: vi.fn(() => ({
      createLiveTranscriptionSession: vi.fn(() => session),
    })),
  };
}

async function importWorker() {
  vi.resetModules();
  return import('./engineWorker');
}

describe('engineWorker', () => {
  beforeEach(() => {
    foundry.createAsync.mockReset();
  });

  it('selects and loads a Foundry model', async () => {
    const session = {};
    const model = createModel(session);
    const manager = { catalog: { getModel: vi.fn(async () => model) } };
    foundry.createAsync.mockResolvedValue(manager);
    const port = createPort();
    const { handleEngineRequest } = await importWorker();

    await handleEngineRequest({ requestId: 'select-1', verb: 'selectModel', modelId: 'nemotron-speech-streaming-en-0.6b' }, port);

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
          sizeBytes: 12 * 1024 * 1024,
        },
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
    const { handleEngineRequest } = await importWorker();

    await handleEngineRequest({
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
    const { handleEngineRequest } = await importWorker();

    await handleEngineRequest({
      requestId: 'start-1',
      verb: 'start',
      sessionId: 'session-1',
      modelId: 'nemotron-speech-streaming-en-0.6b',
    }, port);
    await handleEngineRequest({ requestId: 'append-1', verb: 'append', sessionId: 'session-1', pcm }, port);
    await handleEngineRequest({ requestId: 'end-1', verb: 'end', sessionId: 'session-1' }, port);

    expect(session.append).toHaveBeenCalledWith(pcm);
    expect(session.stop).toHaveBeenCalledTimes(1);
    expect(session.dispose).toHaveBeenCalledTimes(1);
    expect(session.end).not.toHaveBeenCalled();
    expect(port.messages).toContainEqual({ type: 'sessionEnded', sessionId: 'session-1' });
    expect(port.messages).toContainEqual({ requestId: 'end-1', verb: 'end', ok: true });
  });

  it('returns RPC errors for stale session appends', async () => {
    const port = createPort();
    const { handleEngineRequest } = await importWorker();

    await handleEngineRequest({ requestId: 'append-1', verb: 'append', sessionId: 'missing-session', pcm: new Uint8Array() }, port);

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
