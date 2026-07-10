import { Worker } from 'node:worker_threads';

import type {
  TranscriptionEvent,
  VoiceInstallerEvent,
  VoiceWorkerRpcRequest,
  VoiceWorkerRpcResponse,
} from '@chamber/shared/voice-types';
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
  readonly voiceWorkerPath: string;
  readonly voiceSdkEntry: string;
  readonly workerFactory?: (workerPath: string, options: VoiceWorkerLaunchOptions) => VoiceWorkerLike;
  readonly scheduler?: VoiceWorkerPoolScheduler;
  readonly restartBackoffMs?: number;
  readonly maxRestartBackoffMs?: number;
}

export interface VoiceWorkerLaunchOptions {
  readonly workerData: {
    readonly voiceSdkEntry: string;
  };
}

type WorkerRole = 'engine' | 'installer';

interface PendingRequest {
  readonly resolve: (response: VoiceWorkerRpcResponse) => void;
  readonly reject: (error: Error) => void;
}

const DEFAULT_RESTART_BACKOFF_MS = 250;
const DEFAULT_MAX_RESTART_BACKOFF_MS = 5_000;

export class VoiceWorkerPool {
  private readonly voiceWorkerPath: string;
  private readonly voiceSdkEntry: string;
  private readonly workerFactory: (workerPath: string, options: VoiceWorkerLaunchOptions) => VoiceWorkerLike;
  private readonly scheduler: VoiceWorkerPoolScheduler;
  private readonly restartBackoffMs: number;
  private readonly maxRestartBackoffMs: number;
  private readonly engineEvents = new Set<(event: TranscriptionEvent) => void>();
  private readonly installerEvents = new Set<(event: VoiceInstallerEvent) => void>();
  private readonly pending: Record<WorkerRole, Map<string, PendingRequest>> = {
    engine: new Map(),
    installer: new Map(),
  };
  private readonly crashCounts: Record<WorkerRole, number> = {
    engine: 0,
    installer: 0,
  };
  private restartTimer: unknown | null = null;
  private suppressNextExit = false;
  private worker: VoiceWorkerLike | null = null;
  private stopping = false;

  constructor(options: VoiceWorkerPoolOptions) {
    this.voiceWorkerPath = options.voiceWorkerPath;
    this.voiceSdkEntry = options.voiceSdkEntry;
    this.workerFactory = options.workerFactory
      ?? ((workerPath, launchOptions) => new Worker(workerPath, launchOptions) as VoiceWorkerLike);
    this.scheduler = options.scheduler ?? {
      setTimeout: (callback, delay) => setTimeout(callback, delay),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    };
    this.restartBackoffMs = options.restartBackoffMs ?? DEFAULT_RESTART_BACKOFF_MS;
    this.maxRestartBackoffMs = options.maxRestartBackoffMs ?? DEFAULT_MAX_RESTART_BACKOFF_MS;
  }

  start(): void {
    this.stopping = false;
    if (!this.worker) {
      this.worker = this.createWorker();
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.clearRestartTimer();
    this.rejectPending('engine', new Error('Voice engine worker stopped'));
    this.rejectPending('installer', new Error('Voice installer worker stopped'));

    const worker = this.worker;
    this.worker = null;
    if (worker) await worker.terminate();
  }

  sendEngine(req: VoiceWorkerRpcRequest): Promise<VoiceWorkerRpcResponse> {
    return this.send('engine', req);
  }

  sendInstaller(req: VoiceWorkerRpcRequest): Promise<VoiceWorkerRpcResponse> {
    return this.send('installer', req);
  }

  async cancelInstaller(): Promise<void> {
    this.clearRestartTimer();
    this.rejectPending('engine', new Error('Voice worker cancelled'));
    this.rejectPending('installer', new Error('Voice installer worker cancelled'));
    const worker = this.worker;
    this.worker = null;
    if (worker) {
      this.suppressNextExit = true;
      await worker.terminate();
    }
    if (!this.stopping && !this.worker) {
      this.worker = this.createWorker();
    }
  }

  onEngineEvent(cb: (event: TranscriptionEvent) => void): () => void {
    this.engineEvents.add(cb);
    return () => {
      this.engineEvents.delete(cb);
    };
  }

  onInstallerEvent(cb: (event: VoiceInstallerEvent) => void): () => void {
    this.installerEvents.add(cb);
    return () => {
      this.installerEvents.delete(cb);
    };
  }

  getCrashCounts(): Readonly<Record<WorkerRole, number>> {
    return { ...this.crashCounts };
  }

  // Per-role FIFO chain so lifecycle RPCs (selectModel/start/append/end)
  // cannot interleave under rapid PTT release or burst appends. The first
  // queued send still dispatches synchronously so callers and tests observe
  // immediate postMessage; subsequent sends wait for the prior to settle.
  private readonly sendQueues: Record<WorkerRole, Promise<unknown>> = {
    engine: Promise.resolve(),
    installer: Promise.resolve(),
  };
  private readonly inflightCount: Record<WorkerRole, number> = {
    engine: 0,
    installer: 0,
  };

  private send(role: WorkerRole, req: VoiceWorkerRpcRequest): Promise<VoiceWorkerRpcResponse> {
    const worker = this.worker;
    if (!worker) {
      return Promise.reject(new Error('Voice worker is not started'));
    }
    if (this.pending.engine.has(req.requestId) || this.pending.installer.has(req.requestId)) {
      return Promise.reject(new Error(`Duplicate voice worker request: ${req.requestId}`));
    }

    if (this.inflightCount[role] === 0) {
      // Fast path: nothing in flight, dispatch synchronously.
      this.inflightCount[role] += 1;
      const promise = this.dispatch(role, worker, req).finally(() => {
        this.inflightCount[role] -= 1;
      });
      this.sendQueues[role] = promise.catch(() => undefined);
      return promise;
    }

    // Slow path: chain after the in-flight queue.
    const next = this.sendQueues[role].then(() => {
      const w = this.worker;
      if (!w) {
        return Promise.reject(new Error('Voice worker is not started'));
      }
      this.inflightCount[role] += 1;
      return this.dispatch(role, w, req).finally(() => {
        this.inflightCount[role] -= 1;
      });
    });
    this.sendQueues[role] = next.catch(() => undefined);
    return next;
  }

  private dispatch(
    role: WorkerRole,
    worker: VoiceWorkerLike,
    req: VoiceWorkerRpcRequest,
  ): Promise<VoiceWorkerRpcResponse> {
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

  private createWorker(): VoiceWorkerLike {
    const worker = this.workerFactory(this.voiceWorkerPath, {
      workerData: { voiceSdkEntry: this.voiceSdkEntry },
    });
    worker.on('message', (message) => this.handleMessage(message));
    worker.on('error', (error) => this.handleWorkerError(error));
    worker.on('exit', (code) => this.handleWorkerExit(code));
    return worker;
  }

  private handleMessage(message: unknown): void {
    if (isVoiceWorkerRpcResponse(message)) {
      const role = this.findPendingRole(message.requestId);
      if (!role) return;
      const pending = this.pending[role].get(message.requestId);
      if (!pending) return;
      this.pending[role].delete(message.requestId);
      pending.resolve(message);
      return;
    }
    if (isTranscriptionEvent(message)) {
      for (const listener of this.engineEvents) {
        listener(message);
      }
      return;
    }
    if (isVoiceInstallerEvent(message)) {
      for (const listener of this.installerEvents) {
        listener(message);
      }
    }
  }

  private findPendingRole(requestId: string): WorkerRole | null {
    if (this.pending.engine.has(requestId)) return 'engine';
    if (this.pending.installer.has(requestId)) return 'installer';
    return null;
  }

  private handleWorkerError(error: Error): void {
    this.rejectAllPending(new Error(`Voice worker failed: ${error.message}`, { cause: error }));
  }

  private handleWorkerExit(code: number): void {
    this.worker = null;
    this.rejectAllPending(new Error(`Voice worker exited unexpectedly with code ${code}`));
    if (this.suppressNextExit) {
      this.suppressNextExit = false;
      return;
    }
    if (this.stopping) return;

    this.crashCounts.engine += 1;
    this.crashCounts.installer += 1;
    const delay = Math.min(
      this.restartBackoffMs * (2 ** Math.max(0, Math.max(this.crashCounts.engine, this.crashCounts.installer) - 1)),
      this.maxRestartBackoffMs,
    );
    this.restartTimer = this.scheduler.setTimeout(() => {
      this.restartTimer = null;
      if (!this.stopping && !this.worker) {
        this.worker = this.createWorker();
      }
    }, delay);
  }

  private clearRestartTimer(): void {
    const handle = this.restartTimer;
    if (handle === null) return;
    this.scheduler.clearTimeout(handle);
    this.restartTimer = null;
  }

  private rejectPending(role: WorkerRole, error: Error): void {
    for (const pending of this.pending[role].values()) {
      pending.reject(error);
    }
    this.pending[role].clear();
  }

  private rejectAllPending(error: Error): void {
    this.rejectPending('engine', error);
    this.rejectPending('installer', error);
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

function isVoiceInstallerEvent(message: unknown): message is VoiceInstallerEvent {
  return isRecord(message)
    && message.type === 'modelProgress'
    && typeof message.modelId === 'string'
    && typeof message.percent === 'number';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
