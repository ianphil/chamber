import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

import type {
  TranscriptionEvent,
  VoiceInstallerEvent,
  VoiceWorkerRpcRequest,
  VoiceWorkerRpcResponse,
} from '@chamber/shared/voice-types';
import { VoiceWorkerPool, type VoiceWorkerLike, type VoiceWorkerPoolScheduler } from './VoiceWorkerPool';

class FakeWorker extends EventEmitter implements VoiceWorkerLike {
  readonly posted: VoiceWorkerRpcRequest[] = [];
  readonly terminate = vi.fn(async () => 0);

  postMessage(message: VoiceWorkerRpcRequest): void {
    this.posted.push(message);
  }

  emitMessage(message: VoiceWorkerRpcResponse | TranscriptionEvent | VoiceInstallerEvent): void {
    this.emit('message', message);
  }

  emitExit(code: number): void {
    this.emit('exit', code);
  }
}

function createScheduler(): VoiceWorkerPoolScheduler & { runNext(): void; delays: number[] } {
  const callbacks: Array<() => void> = [];
  return {
    delays: [],
    setTimeout(callback, delay) {
      callbacks.push(callback);
      this.delays.push(delay);
      return callbacks.length;
    },
    clearTimeout: vi.fn(),
    runNext() {
      const callback = callbacks.shift();
      if (!callback) throw new Error('No scheduled callback');
      callback();
    },
  };
}

describe('VoiceWorkerPool', () => {
  it('starts one worker and resolves engine and installer RPC responses', async () => {
    const workers: FakeWorker[] = [];
    const pool = new VoiceWorkerPool({
      voiceWorkerPath: 'voiceWorker.js',
      voiceSdkEntry: 'foundry-entry.js',
      workerFactory: (workerPath, options) => {
        const worker = new FakeWorker();
        workers.push(worker);
        expect(workerPath).toBe('voiceWorker.js');
        expect(options.workerData.voiceSdkEntry).toBe('foundry-entry.js');
        return worker;
      },
    });

    pool.start();
    const engineRequest: VoiceWorkerRpcRequest = { requestId: 'engine-1', verb: 'refresh' };
    const installerRequest: VoiceWorkerRpcRequest = { requestId: 'installer-1', verb: 'installRuntime' };
    const engineResponse = pool.sendEngine(engineRequest);
    const installerResponse = pool.sendInstaller(installerRequest);

    expect(workers).toHaveLength(1);
    expect(workers[0].posted).toEqual([engineRequest, installerRequest]);

    workers[0].emitMessage({ requestId: 'engine-1', verb: 'refresh', ok: true, statuses: [] });
    workers[0].emitMessage({ requestId: 'installer-1', verb: 'installRuntime', ok: true });

    await expect(engineResponse).resolves.toEqual({ requestId: 'engine-1', verb: 'refresh', ok: true, statuses: [] });
    await expect(installerResponse).resolves.toEqual({ requestId: 'installer-1', verb: 'installRuntime', ok: true });
  });

  it('forwards engine transcript events until unsubscribed', () => {
    const engine = new FakeWorker();
    const pool = new VoiceWorkerPool({
      voiceWorkerPath: 'voiceWorker.js',
      voiceSdkEntry: 'foundry-entry.js',
      workerFactory: () => engine,
    });
    const events: TranscriptionEvent[] = [];

    pool.start();
    const unsubscribe = pool.onEngineEvent((event) => events.push(event));
    engine.emitMessage({ type: 'partial', sessionId: 'session-1', text: 'hello chamber' });
    unsubscribe();
    engine.emitMessage({ type: 'final', sessionId: 'session-1', text: 'ignored', isFinal: true });

    expect(events).toEqual([{ type: 'partial', sessionId: 'session-1', text: 'hello chamber' }]);
  });

  it('forwards installer progress events until unsubscribed', () => {
    const worker = new FakeWorker();
    const pool = new VoiceWorkerPool({
      voiceWorkerPath: 'voiceWorker.js',
      voiceSdkEntry: 'foundry-entry.js',
      workerFactory: () => worker,
    });
    const events: VoiceInstallerEvent[] = [];

    pool.start();
    const unsubscribe = pool.onInstallerEvent((event) => events.push(event));
    worker.emitMessage({ type: 'modelProgress', modelId: 'nemotron-speech-streaming-en-0.6b', percent: 42 });
    unsubscribe();
    worker.emitMessage({ type: 'modelProgress', modelId: 'nemotron-speech-streaming-en-0.6b', percent: 99 });

    expect(events).toEqual([{ type: 'modelProgress', modelId: 'nemotron-speech-streaming-en-0.6b', percent: 42 }]);
  });

  it('restarts a crashed worker with bounded backoff and surfaces crash counts', () => {
    const scheduler = createScheduler();
    const workers: FakeWorker[] = [];
    const pool = new VoiceWorkerPool({
      voiceWorkerPath: 'voiceWorker.js',
      voiceSdkEntry: 'foundry-entry.js',
      workerFactory: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
      scheduler,
      restartBackoffMs: 10,
      maxRestartBackoffMs: 15,
    });

    pool.start();
    workers[0].emitExit(1);
    expect(pool.getCrashCounts()).toEqual({ engine: 1, installer: 1 });
    expect(scheduler.delays).toEqual([10]);

    scheduler.runNext();
    workers[1].emitExit(1);
    expect(pool.getCrashCounts()).toEqual({ engine: 2, installer: 2 });
    expect(scheduler.delays).toEqual([10, 15]);
  });

  it('rejects pending requests when a worker exits unexpectedly', async () => {
    const engine = new FakeWorker();
    const pool = new VoiceWorkerPool({
      voiceWorkerPath: 'voiceWorker.js',
      voiceSdkEntry: 'foundry-entry.js',
      workerFactory: () => engine,
      scheduler: createScheduler(),
    });

    pool.start();
    const pending = pool.sendEngine({ requestId: 'engine-1', verb: 'refresh' });
    engine.emitExit(1);

    await expect(pending).rejects.toThrow(/voice worker exited/i);
  });

  it('terminates workers without scheduling restarts', async () => {
    const scheduler = createScheduler();
    const workers = [new FakeWorker()];
    const pool = new VoiceWorkerPool({
      voiceWorkerPath: 'voiceWorker.js',
      voiceSdkEntry: 'foundry-entry.js',
      workerFactory: () => workers.shift() ?? new FakeWorker(),
      scheduler,
    });

    pool.start();
    await pool.stop();

    expect(scheduler.delays).toEqual([]);
  });
});
