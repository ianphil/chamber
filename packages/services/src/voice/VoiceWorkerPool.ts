import { Worker } from 'node:worker_threads';

import type { TranscriptionEvent, VoiceWorkerRpcRequest, VoiceWorkerRpcResponse } from '@chamber/shared/voice-types';
import { getErrorMessage } from '@chamber/shared/getErrorMessage';

export interface VoiceWorkerLike {
  postMessage(message: VoiceWorkerRpcRequest): void;
  on(event: 'message', listener: (message: unknown) => void): this;
  on(event: 'exit', listener: (code: number) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  terminate(): Promise<number> | number;
}

export interface VoiceWorkerPoolScheduler {
  setTimeout(callback: () => void, delay: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface VoiceWorkerPoolOptions {
  readonly engineWorkerPath: string;
  readonly installerWorkerPath: string;
  readonly workerFactory?: (workerPath: string) => VoiceWorkerLike;
  readonly scheduler?: VoiceWorkerPoolScheduler;
  readonly restartBackoffMs?: number;
  readonly maxRestartBackoffMs?: number;
}

type WorkerRole = 'engine' | 'installer';

interface PendingRequest {
  readonly resolve: (response: VoiceWorkerRpcResponse) => void;
  readonly reject: (error: Error) => void;
}

const DEFAULT_RESTART_BACKOFF_MS = 250;
const DEFAULT_MAX_RESTART_BACKOFF_MS = 5_000;

export class VoiceWorkerPool {
  private readonly engineWorkerPath: string;
  private readonly installerWorkerPath: string;
  private readonly workerFactory: (workerPath: string) => VoiceWorkerLike;
  private readonly scheduler: VoiceWorkerPoolScheduler;
  private readonly restartBackoffMs: number;
  private readonly maxRestartBackoffMs: number;
  private readonly engineEvents = new Set<(event: TranscriptionEvent) => void>();
  private readonly pending: Record<WorkerRole, Map<string, PendingRequest>> = {
    engine: new Map(),
    installer: new Map(),
  };
  private readonly crashCounts: Record<WorkerRole, number> = {
    engine: 0,
    installer: 0,
  };
  private readonly restartTimers: Record<WorkerRole, unknown | null> = {
    engine: null,
    installer: null,
  };
  private workers: Record<WorkerRole, VoiceWorkerLike | null> = {
    engine: null,
    installer: null,
  };
  private stopping = false;

  constructor(options: VoiceWorkerPoolOptions) {
    this.engineWorkerPath = options.engineWorkerPath;
    this.installerWorkerPath = options.installerWorkerPath;
    this.workerFactory = options.workerFactory ?? ((workerPath) => new Worker(workerPath) as VoiceWorkerLike);
    this.scheduler = options.scheduler ?? {
      setTimeout: (callback, delay) => setTimeout(callback, delay),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    };
    this.restartBackoffMs = options.restartBackoffMs ?? DEFAULT_RESTART_BACKOFF_MS;
    this.maxRestartBackoffMs = options.maxRestartBackoffMs ?? DEFAULT_MAX_RESTART_BACKOFF_MS;
  }

  start(): void {
    this.stopping = false;
    if (!this.workers.engine) {
      this.workers.engine = this.createWorker('engine');
    }
    if (!this.workers.installer) {
      this.workers.installer = this.createWorker('installer');
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.clearRestartTimer('engine');
    this.clearRestartTimer('installer');
    this.rejectPending('engine', new Error('Voice engine worker stopped'));
    this.rejectPending('installer', new Error('Voice installer worker stopped'));

    const workers = [this.workers.engine, this.workers.installer].filter((worker): worker is VoiceWorkerLike => worker !== null);
    this.workers = { engine: null, installer: null };
    await Promise.all(workers.map(async (worker) => {
      await worker.terminate();
    }));
  }

  sendEngine(req: VoiceWorkerRpcRequest): Promise<VoiceWorkerRpcResponse> {
    return this.send('engine', req);
  }

  sendInstaller(req: VoiceWorkerRpcRequest): Promise<VoiceWorkerRpcResponse> {
    return this.send('installer', req);
  }

  onEngineEvent(cb: (event: TranscriptionEvent) => void): () => void {
    this.engineEvents.add(cb);
    return () => {
      this.engineEvents.delete(cb);
    };
  }

  getCrashCounts(): Readonly<Record<WorkerRole, number>> {
    return { ...this.crashCounts };
  }

  private send(role: WorkerRole, req: VoiceWorkerRpcRequest): Promise<VoiceWorkerRpcResponse> {
    const worker = this.workers[role];
    if (!worker) {
      return Promise.reject(new Error(`Voice ${role} worker is not started`));
    }
    if (this.pending[role].has(req.requestId)) {
      return Promise.reject(new Error(`Duplicate voice ${role} worker request: ${req.requestId}`));
    }

    return new Promise((resolve, reject) => {
      this.pending[role].set(req.requestId, { resolve, reject });
      try {
        worker.postMessage(req);
      } catch (err) {
        this.pending[role].delete(req.requestId);
        reject(new Error(`Failed to post message to voice ${role} worker: ${getErrorMessage(err)}`, { cause: err }));
      }
    });
  }

  private createWorker(role: WorkerRole): VoiceWorkerLike {
    const workerPath = role === 'engine' ? this.engineWorkerPath : this.installerWorkerPath;
    const worker = this.workerFactory(workerPath);
    worker.on('message', (message) => this.handleMessage(role, message));
    worker.on('error', (error) => this.handleWorkerError(role, error));
    worker.on('exit', (code) => this.handleWorkerExit(role, code));
    return worker;
  }

  private handleMessage(role: WorkerRole, message: unknown): void {
    if (isVoiceWorkerRpcResponse(message)) {
      const pending = this.pending[role].get(message.requestId);
      if (!pending) return;
      this.pending[role].delete(message.requestId);
      pending.resolve(message);
      return;
    }
    if (role === 'engine' && isTranscriptionEvent(message)) {
      for (const listener of this.engineEvents) {
        listener(message);
      }
    }
  }

  private handleWorkerError(role: WorkerRole, error: Error): void {
    this.rejectPending(role, new Error(`Voice ${role} worker failed: ${error.message}`, { cause: error }));
  }

  private handleWorkerExit(role: WorkerRole, code: number): void {
    this.workers[role] = null;
    this.rejectPending(role, new Error(`Voice ${role} worker exited unexpectedly with code ${code}`));
    if (this.stopping) return;

    this.crashCounts[role] += 1;
    const delay = Math.min(
      this.restartBackoffMs * (2 ** Math.max(0, this.crashCounts[role] - 1)),
      this.maxRestartBackoffMs,
    );
    this.restartTimers[role] = this.scheduler.setTimeout(() => {
      this.restartTimers[role] = null;
      if (!this.stopping && !this.workers[role]) {
        this.workers[role] = this.createWorker(role);
      }
    }, delay);
  }

  private clearRestartTimer(role: WorkerRole): void {
    const handle = this.restartTimers[role];
    if (handle === null) return;
    this.scheduler.clearTimeout(handle);
    this.restartTimers[role] = null;
  }

  private rejectPending(role: WorkerRole, error: Error): void {
    for (const pending of this.pending[role].values()) {
      pending.reject(error);
    }
    this.pending[role].clear();
  }
}

function isVoiceWorkerRpcResponse(message: unknown): message is VoiceWorkerRpcResponse {
  if (!isRecord(message)) return false;
  return typeof message.requestId === 'string'
    && typeof message.verb === 'string'
    && typeof message.ok === 'boolean';
}

function isTranscriptionEvent(message: unknown): message is TranscriptionEvent {
  if (!isRecord(message) || typeof message.type !== 'string') return false;
  if (typeof message.sessionId !== 'string') return false;
  if (message.type === 'partial' || message.type === 'final') {
    return typeof message.text === 'string';
  }
  if (message.type === 'error') {
    return typeof message.message === 'string';
  }
  return message.type === 'sessionStarted' || message.type === 'sessionEnded';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
