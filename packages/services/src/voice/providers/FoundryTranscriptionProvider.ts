import { randomUUID } from 'node:crypto';

import {
  VOICE_DICTATION_MODEL_ID,
  type TranscriptionEvent,
  type VoiceWorkerRpcRequest,
  type VoiceWorkerRpcResponse,
} from '@chamber/shared/voice-types';
import type { VoiceWorkerPool } from '../VoiceWorkerPool';
import type { TranscriptionProvider, TranscriptionProviderStartOptions } from './types';

export interface FoundryTranscriptionProviderOptions {
  readonly modelId?: string;
}

export class FoundryTranscriptionProvider implements TranscriptionProvider {
  private readonly pool: Pick<VoiceWorkerPool, 'sendEngine' | 'onEngineEvent'>;
  private readonly modelId: string;
  private readonly listeners = new Set<(event: TranscriptionEvent) => void>();
  private activeSessionId: string | null = null;
  private readonly unsubscribePool: () => void;

  constructor(pool: Pick<VoiceWorkerPool, 'sendEngine' | 'onEngineEvent'>, options: FoundryTranscriptionProviderOptions = {}) {
    this.pool = pool;
    this.modelId = options.modelId ?? VOICE_DICTATION_MODEL_ID;
    this.unsubscribePool = this.pool.onEngineEvent((event) => this.handleEngineEvent(event));
  }

  async start(opts: TranscriptionProviderStartOptions): Promise<void> {
    if (this.activeSessionId) {
      throw new Error('Foundry transcription provider is already started');
    }
    this.activeSessionId = opts.sessionId;
    try {
      await this.sendAndAssert({
        requestId: randomUUID(),
        verb: 'start',
        sessionId: opts.sessionId,
        modelId: this.modelId,
      });
    } catch (err) {
      this.activeSessionId = null;
      throw err;
    }
  }

  async append(pcm: Uint8Array): Promise<void> {
    const sessionId = this.requireActiveSessionId();
    await this.sendAndAssert({
      requestId: randomUUID(),
      verb: 'append',
      sessionId,
      pcm,
    });
  }

  async end(): Promise<void> {
    if (!this.activeSessionId) return;
    const sessionId = this.activeSessionId;
    try {
      await this.sendAndAssert({
        requestId: randomUUID(),
        verb: 'end',
        sessionId,
      });
    } finally {
      this.activeSessionId = null;
    }
  }

  onEvent(cb: (event: TranscriptionEvent) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  dispose(): void {
    this.unsubscribePool();
    this.listeners.clear();
  }

  private async sendAndAssert(request: VoiceWorkerRpcRequest): Promise<void> {
    const response = await this.pool.sendEngine(request);
    assertRpcSucceeded(response);
  }

  private handleEngineEvent(event: TranscriptionEvent): void {
    if (event.sessionId !== this.activeSessionId) return;
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private requireActiveSessionId(): string {
    if (!this.activeSessionId) {
      throw new Error('No active Foundry transcription session');
    }
    return this.activeSessionId;
  }
}

function assertRpcSucceeded(
  response: VoiceWorkerRpcResponse,
): asserts response is Extract<VoiceWorkerRpcResponse, { readonly ok: true }> {
  if (!response.ok) {
    throw new Error(response.error);
  }
}
