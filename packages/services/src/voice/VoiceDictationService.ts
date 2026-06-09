import { randomUUID } from 'node:crypto';

import {
  VOICE_DICTATION_MODEL_ID,
  type TranscriptionEvent,
  type VoiceDictationConfig,
  type VoiceMicTestResult,
  type VoiceModelStatus,
  type VoicePermissionState,
  type VoiceWorkerRpcRequest,
  type VoiceWorkerRpcResponse,
} from '@chamber/shared/voice-types';
import { getErrorMessage } from '@chamber/shared/getErrorMessage';
import type { PermissionInspector } from './permissions/types';
import type { TranscriptionProvider } from './providers/types';
import type { VoiceDictationStore } from './VoiceDictationStore';

export interface VoiceWorkerPoolPort {
  sendInstaller(req: VoiceWorkerRpcRequest): Promise<VoiceWorkerRpcResponse>;
}

export interface VoiceDictationServiceOptions {
  readonly store: VoiceDictationStore;
  readonly provider: TranscriptionProvider;
  readonly permissions: PermissionInspector;
  readonly workerPool?: VoiceWorkerPoolPort;
}

export class VoiceDictationService {
  private readonly store: VoiceDictationStore;
  private readonly provider: TranscriptionProvider;
  private readonly permissions: PermissionInspector;
  private readonly workerPool?: VoiceWorkerPoolPort;
  private readonly transcriptListeners = new Set<(event: TranscriptionEvent) => void>();
  private readonly configListeners = new Set<(config: VoiceDictationConfig | null) => void>();
  private sessionAbort: AbortController | null = null;
  private activeSessionId: string | null = null;

  constructor(options: VoiceDictationServiceOptions) {
    this.store = options.store;
    this.provider = options.provider;
    this.permissions = options.permissions;
    this.workerPool = options.workerPool;
    this.provider.onEvent((event) => this.emitTranscript(event));
  }

  getConfig(): Promise<VoiceDictationConfig | null> {
    return this.store.load();
  }

  async saveConfig(config: VoiceDictationConfig): Promise<void> {
    await this.store.save(config);
    this.emitConfigChanged(config);
  }

  getPermissionState(): Promise<VoicePermissionState> {
    return this.permissions.getState();
  }

  async openPreferences(): Promise<void> {
    await this.permissions.openPreferences?.();
  }

  async getModelStatus(modelId: string): Promise<VoiceModelStatus> {
    assertKnownModel(modelId);
    if (this.workerPool) {
      const response = await this.workerPool.sendInstaller({
        requestId: randomUUID(),
        verb: 'refresh',
      });
      assertRpcSucceeded(response);
      const status = response.status ?? response.statuses?.find((candidate) => candidate.id === modelId);
      if (status) return status;
    }

    const config = await this.store.load();
    return {
      id: VOICE_DICTATION_MODEL_ID,
      status: 'not-downloaded',
      ...(config?.model.downloadedAt ? { downloadedAt: config.model.downloadedAt } : {}),
    };
  }

  async downloadModel(modelId: string): Promise<void> {
    assertKnownModel(modelId);
    if (!this.workerPool) {
      throw new Error('Voice worker pool is unavailable');
    }
    const response = await this.workerPool.sendInstaller({
      requestId: randomUUID(),
      verb: 'downloadModel',
      modelId,
    });
    assertRpcSucceeded(response);
  }

  async startSession(sessionId: string): Promise<void> {
    if (this.activeSessionId) {
      throw new Error('A voice dictation session is already active');
    }
    const permissionState = await this.permissions.getState();
    if (permissionState === 'denied' || permissionState === 'restricted' || permissionState === 'unsupported') {
      throw new Error(`Cannot start voice dictation: microphone permission is ${permissionState}`);
    }

    const abort = new AbortController();
    this.sessionAbort = abort;
    this.activeSessionId = sessionId;
    try {
      await this.provider.start({ sessionId, signal: abort.signal });
    } catch (err) {
      this.sessionAbort = null;
      this.activeSessionId = null;
      throw err;
    }
  }

  async appendAudio(sessionId: string, pcm: Uint8Array): Promise<void> {
    this.assertActiveSession(sessionId);
    await this.provider.append(pcm);
  }

  async endSession(sessionId: string): Promise<void> {
    if (!this.activeSessionId) return;
    this.assertActiveSession(sessionId);
    const abort = this.sessionAbort;
    this.sessionAbort = null;
    this.activeSessionId = null;
    abort?.abort();
    await this.provider.end();
  }

  private assertActiveSession(sessionId: string): void {
    if (!this.activeSessionId || !this.sessionAbort) {
      throw new Error('No active voice dictation session');
    }
    if (this.activeSessionId !== sessionId) {
      throw new Error(`Ignoring stale voice dictation session ${sessionId}`);
    }
  }

  async testMic(): Promise<VoiceMicTestResult> {
    let transcript: string | null = null;
    let eventError: string | null = null;
    const unsubscribe = this.subscribeTranscript((event) => {
      if (event.type === 'final') transcript = event.text;
      if (event.type === 'error') eventError = event.message;
    });
    const sessionId = randomUUID();

    try {
      await this.startSession(sessionId);
      for (let index = 0; index < 3; index += 1) {
        await this.appendAudio(sessionId, new Uint8Array());
      }
      await this.endSession(sessionId);
      if (eventError) return { success: false, error: eventError };
      if (transcript) return { success: true, transcript };
      return { success: false, error: 'No transcript was produced.' };
    } catch (err) {
      await this.endSession(sessionId);
      return { success: false, error: getErrorMessage(err) };
    } finally {
      unsubscribe();
    }
  }

  subscribeTranscript(cb: (event: TranscriptionEvent) => void): () => void {
    this.transcriptListeners.add(cb);
    return () => {
      this.transcriptListeners.delete(cb);
    };
  }

  subscribeConfigChanged(cb: (config: VoiceDictationConfig | null) => void): () => void {
    this.configListeners.add(cb);
    return () => {
      this.configListeners.delete(cb);
    };
  }

  private emitTranscript(event: TranscriptionEvent): void {
    for (const listener of this.transcriptListeners) {
      listener(event);
    }
  }

  private emitConfigChanged(config: VoiceDictationConfig | null): void {
    for (const listener of this.configListeners) {
      listener(config);
    }
  }
}

function assertKnownModel(modelId: string): asserts modelId is typeof VOICE_DICTATION_MODEL_ID {
  if (modelId !== VOICE_DICTATION_MODEL_ID) {
    throw new Error(`Unsupported voice dictation model: ${modelId}`);
  }
}

function assertRpcSucceeded(
  response: VoiceWorkerRpcResponse,
): asserts response is Extract<VoiceWorkerRpcResponse, { readonly ok: true }> {
  if (!response.ok) {
    throw new Error(response.error);
  }
}
