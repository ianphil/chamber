import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  VOICE_DICTATION_MODEL_ID,
  type TranscriptionEvent,
  type VoiceDictationConfig,
  type VoiceInstallerEvent,
  type VoiceModelStatus,
  type VoicePermissionState,
  type VoiceWorkerRpcRequest,
} from '@chamber/shared/voice-types';
import { FAKE_SENTINEL_TRANSCRIPT, FakeTranscriptionProvider } from './providers/FakeTranscriptionProvider';
import type { PermissionInspector } from './permissions/types';
import { VoiceDictationService } from './VoiceDictationService';
import { VoiceDictationStore } from './VoiceDictationStore';

const TEST_ROOT = path.join(process.cwd(), '.cache', 'voice-dictation-service-tests');

function createConfig(overrides: Partial<VoiceDictationConfig> = {}): VoiceDictationConfig {
  return {
    enabled: true,
    inputDeviceId: null,
    shortcut: 'Alt+Shift+V',
    pushToTalk: true,
    model: {
      id: VOICE_DICTATION_MODEL_ID,
    },
    ...overrides,
  };
}

describe('VoiceDictationService', () => {
  let storeDir: string;
  let store: VoiceDictationStore;
  let permissions: PermissionInspector;

  beforeEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    storeDir = path.join(TEST_ROOT, `case-${Date.now()}`);
    store = new VoiceDictationStore({ storeDir });
    permissions = {
      getState: vi.fn<() => Promise<VoicePermissionState>>(async () => 'granted'),
      openPreferences: vi.fn(async () => undefined),
    };
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('loads, saves, and broadcasts config changes', async () => {
    const provider = new FakeTranscriptionProvider({ clock: (callback) => callback() });
    const service = new VoiceDictationService({ store, provider, permissions });
    const changes: Array<VoiceDictationConfig | null> = [];
    service.subscribeConfigChanged((config) => changes.push(config));
    const config = createConfig();

    await expect(service.getConfig()).resolves.toBeNull();
    await service.saveConfig(config);

    await expect(service.getConfig()).resolves.toEqual(config);
    expect(changes).toEqual([config]);
  });

  it('delegates permission state and preference opening', async () => {
    const provider = new FakeTranscriptionProvider();
    const service = new VoiceDictationService({ store, provider, permissions });

    await expect(service.getPermissionState()).resolves.toBe('granted');
    await service.openPreferences();

    expect(permissions.openPreferences).toHaveBeenCalledOnce();
  });

  it('runs one transcription session at a time and forwards transcript events', async () => {
    const provider = new FakeTranscriptionProvider({ chunksUntilFinal: 1, clock: (callback) => callback() });
    const service = new VoiceDictationService({ store, provider, permissions });
    const events: TranscriptionEvent[] = [];
    const sessionId = 'voice-session-1';
    service.subscribeTranscript((event) => events.push(event));

    await service.startSession(sessionId);
    await expect(service.startSession('voice-session-2')).rejects.toThrow(/already active/i);
    await expect(service.appendAudio('stale-session', new Uint8Array([1]))).rejects.toThrow(/stale voice dictation session/i);
    await service.appendAudio(sessionId, new Uint8Array([1]));
    await service.endSession(sessionId);
    await service.endSession(sessionId);

    expect(events).toEqual([
      { type: 'sessionStarted', sessionId },
      { type: 'partial', sessionId, text: 'hello chamber' },
      { type: 'final', sessionId, text: FAKE_SENTINEL_TRANSCRIPT, isFinal: true },
      { type: 'sessionEnded', sessionId },
    ]);
  });

  it('does not start a session when microphone permission is denied', async () => {
    permissions.getState = vi.fn<() => Promise<VoicePermissionState>>(async () => 'denied');
    const provider = new FakeTranscriptionProvider({ clock: (callback) => callback() });
    const service = new VoiceDictationService({ store, provider, permissions });

    await expect(service.startSession('voice-session-1')).rejects.toThrow(/microphone permission is denied/i);
  });

  it('returns model status from the worker pool when available', async () => {
    const sendInstaller = vi.fn(async (request: VoiceWorkerRpcRequest) => ({
      requestId: request.requestId,
      verb: request.verb,
      ok: true as const,
      statuses: [{ id: VOICE_DICTATION_MODEL_ID, status: 'ready' as const }],
    }));
    const service = new VoiceDictationService({
      store,
      provider: new FakeTranscriptionProvider(),
      permissions,
      workerPool: { sendInstaller },
    });

    await expect(service.getModelStatus(VOICE_DICTATION_MODEL_ID)).resolves.toEqual({
      id: VOICE_DICTATION_MODEL_ID,
      status: 'ready',
    });
  });

  it('downloads models through the worker pool and surfaces failures', async () => {
    const sendInstaller = vi.fn(async (request: VoiceWorkerRpcRequest) => ({
      requestId: request.requestId,
      verb: request.verb,
      ok: false as const,
      error: 'download failed',
    }));
    const service = new VoiceDictationService({
      store,
      provider: new FakeTranscriptionProvider(),
      permissions,
      workerPool: { sendInstaller },
    });

    await expect(service.downloadModel(VOICE_DICTATION_MODEL_ID)).rejects.toThrow(/download failed/i);
  });

  it('forwards model download progress from worker events', async () => {
    let progressListener: ((event: VoiceInstallerEvent) => void) | null = null;
    const unsubscribe = vi.fn();
    const sendInstaller = vi.fn(async (request: VoiceWorkerRpcRequest) => {
      progressListener?.({
        type: 'modelProgress',
        modelId: VOICE_DICTATION_MODEL_ID,
        percent: 42,
        sizeBytes: 1024,
      });
      return {
        requestId: request.requestId,
        verb: request.verb,
        ok: true as const,
        status: { id: VOICE_DICTATION_MODEL_ID, status: 'ready' as const, sizeBytes: 1024 },
      };
    });
    const service = new VoiceDictationService({
      store,
      provider: new FakeTranscriptionProvider(),
      permissions,
      workerPool: {
        sendInstaller,
        onInstallerEvent: (listener) => {
          progressListener = listener;
          return unsubscribe;
        },
      },
    });
    const statuses: VoiceModelStatus[] = [];

    await service.downloadModel(VOICE_DICTATION_MODEL_ID, (status) => statuses.push(status));

    expect(statuses).toEqual([
      { id: VOICE_DICTATION_MODEL_ID, status: 'downloading' },
      { id: VOICE_DICTATION_MODEL_ID, status: 'downloading', percent: 42, sizeBytes: 1024 },
      { id: VOICE_DICTATION_MODEL_ID, status: 'ready', sizeBytes: 1024 },
    ]);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('testMic checks permission and model readiness without opening a transcription session', async () => {
    const provider = new FakeTranscriptionProvider({ clock: (callback) => callback() });
    const sendInstaller = vi.fn(async (request: VoiceWorkerRpcRequest) => ({
      requestId: request.requestId,
      verb: request.verb,
      ok: true as const,
      status: { id: VOICE_DICTATION_MODEL_ID, status: 'ready' as const },
    }));
    const service = new VoiceDictationService({
      store,
      provider,
      permissions,
      workerPool: { sendInstaller },
    });
    const startSpy = vi.spyOn(provider, 'start');

    await expect(service.testMic()).resolves.toEqual({ success: true });
    expect(startSpy).not.toHaveBeenCalled();
    expect(sendInstaller).toHaveBeenCalledWith(expect.objectContaining({ verb: 'refresh' }));
  });

  it('testMic returns clear readiness failures', async () => {
    permissions.getState = vi.fn<() => Promise<VoicePermissionState>>(async () => 'not-determined');
    const service = new VoiceDictationService({
      store,
      provider: new FakeTranscriptionProvider(),
      permissions,
      workerPool: {
        sendInstaller: vi.fn(async (request: VoiceWorkerRpcRequest) => ({
          requestId: request.requestId,
          verb: request.verb,
          ok: true as const,
          status: { id: VOICE_DICTATION_MODEL_ID, status: 'ready' as const },
        })),
      },
    });

    await expect(service.testMic()).resolves.toEqual({
      success: false,
      error: 'Cannot test microphone: microphone permission is not-determined',
    });

    permissions.getState = vi.fn<() => Promise<VoicePermissionState>>(async () => 'granted');
    const notReadyService = new VoiceDictationService({
      store,
      provider: new FakeTranscriptionProvider(),
      permissions,
      workerPool: {
        sendInstaller: vi.fn(async (request: VoiceWorkerRpcRequest) => ({
          requestId: request.requestId,
          verb: request.verb,
          ok: true as const,
          status: { id: VOICE_DICTATION_MODEL_ID, status: 'not-downloaded' as const },
        })),
      },
    });
    await expect(notReadyService.testMic()).resolves.toEqual({
      success: false,
      error: 'Download the voice dictation model before testing the microphone.',
    });
  });
});
