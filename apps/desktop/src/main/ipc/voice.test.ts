import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn().mockReturnValue([]) },
}));

import { BrowserWindow, ipcMain } from 'electron';
import { setupVoiceIPC } from './voice';
import { IPC, VOICE_DICTATION_MODEL_ID, VOICE_MAX_APPEND_CHUNK_BYTES } from '@chamber/shared';
import type {
  TranscriptionEvent,
  VoiceDictationConfig,
  VoiceMicTestResult,
  VoiceModelStatus,
  VoicePermissionState,
} from '@chamber/shared';
import { FakeTranscriptionProvider, type VoiceDictationService } from '@chamber/services';
import { FAKE_SENTINEL_TRANSCRIPT } from '@chamber/services';

type IpcHandler = (event: { sender: MockWebContents }, ...args: unknown[]) => Promise<unknown>;

interface MockWebContents {
  readonly id: number;
  readonly send: ReturnType<typeof vi.fn>;
  readonly once: ReturnType<typeof vi.fn>;
  readonly isDestroyed: ReturnType<typeof vi.fn>;
}

interface MockVoiceService {
  readonly getConfig: ReturnType<typeof vi.fn<() => Promise<VoiceDictationConfig | null>>>;
  readonly saveConfig: ReturnType<typeof vi.fn<(config: VoiceDictationConfig) => Promise<void>>>;
  readonly getPermissionState: ReturnType<typeof vi.fn<() => Promise<VoicePermissionState>>>;
  readonly openPreferences: ReturnType<typeof vi.fn<() => Promise<void>>>;
  readonly getModelStatus: ReturnType<typeof vi.fn<(modelId: string) => Promise<VoiceModelStatus>>>;
  readonly downloadModel: ReturnType<
    typeof vi.fn<(modelId: string, progressCb?: (status: VoiceModelStatus) => void) => Promise<void>>
  >;
  readonly cancelDownload: ReturnType<typeof vi.fn<(modelId: string) => Promise<void>>>;
  readonly startSession: ReturnType<
    typeof vi.fn<(request: { sessionId: string; deviceId?: string | null; modelId?: string }) => Promise<void>>
  >;
  readonly appendAudio: ReturnType<typeof vi.fn<(sessionId: string, chunk: Uint8Array) => Promise<void>>>;
  readonly endSession: ReturnType<typeof vi.fn<(sessionId: string) => Promise<void>>>;
  readonly testMic: ReturnType<typeof vi.fn<() => Promise<VoiceMicTestResult>>>;
  readonly subscribeTranscript: ReturnType<typeof vi.fn<(cb: (event: TranscriptionEvent) => void) => () => void>>;
  readonly setProviderForTesting: ReturnType<typeof vi.fn<(provider: FakeTranscriptionProvider) => void>>;
  readonly emitTranscript: (event: TranscriptionEvent) => void;
}

const validConfig: VoiceDictationConfig = {
  enabled: true,
  inputDeviceId: null,
  shortcut: 'Alt+Shift+V',
  pushToTalk: true,
  model: { id: VOICE_DICTATION_MODEL_ID },
};

const readyStatus: VoiceModelStatus = {
  id: VOICE_DICTATION_MODEL_ID,
  status: 'ready',
};

describe('setupVoiceIPC', () => {
  beforeEach(() => {
    vi.mocked(ipcMain.handle).mockClear();
    vi.mocked(BrowserWindow.getAllWindows).mockReset();
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([]);
  });

  it('registers the voice handlers and keeps e2e handlers disabled by default', () => {
    setupVoiceIPC(createMockService() as unknown as VoiceDictationService);

    const channels = registeredChannels();
    expect(channels).toContain(IPC.VOICE.GET_CONFIG);
    expect(channels).toContain(IPC.VOICE.SAVE_CONFIG);
    expect(channels).toContain(IPC.VOICE.GET_PERMISSION_STATE);
    expect(channels).toContain(IPC.VOICE.OPEN_MIC_PREFERENCES);
    expect(channels).toContain(IPC.VOICE.GET_MODEL_STATUS);
    expect(channels).toContain(IPC.VOICE.DOWNLOAD_MODEL);
    expect(channels).toContain(IPC.VOICE.CANCEL_DOWNLOAD);
    expect(channels).toContain(IPC.VOICE.START_SESSION);
    expect(channels).toContain(IPC.VOICE.APPEND_AUDIO);
    expect(channels).toContain(IPC.VOICE.END_SESSION);
    expect(channels).toContain(IPC.VOICE.TEST_MIC);
    expect(channels).not.toContain(IPC.E2E.VOICE_SET_FAKE_PROVIDER);
    expect(channels).not.toContain(IPC.E2E.VOICE_EMIT_TRANSCRIPT);
  });

  it('forwards getConfig to the service', async () => {
    const service = createMockService();
    service.getConfig.mockResolvedValue(validConfig);
    setupVoiceIPC(service as unknown as VoiceDictationService);

    await expect(invoke(IPC.VOICE.GET_CONFIG)).resolves.toEqual(validConfig);
    expect(service.getConfig).toHaveBeenCalledOnce();
  });

  it('validates saveConfig, persists through the service, and broadcasts changed config', async () => {
    const service = createMockService();
    const firstSend = vi.fn();
    const secondSend = vi.fn();
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      { webContents: { send: firstSend } },
      { webContents: { send: secondSend } },
    ] as never);
    setupVoiceIPC(service as unknown as VoiceDictationService);

    await invoke(IPC.VOICE.SAVE_CONFIG, validConfig);

    expect(service.saveConfig).toHaveBeenCalledWith(validConfig);
    expect(firstSend).toHaveBeenCalledWith(IPC.VOICE.CHANGED, validConfig);
    expect(secondSend).toHaveBeenCalledWith(IPC.VOICE.CHANGED, validConfig);

    await expect(invoke(IPC.VOICE.SAVE_CONFIG, { enabled: true })).rejects.toThrow(/voice:saveConfig: invalid payload/);
  });

  it('forwards permission, preference, model, cancel, and mic-test handlers', async () => {
    const service = createMockService();
    service.getPermissionState.mockResolvedValue('granted');
    service.getModelStatus.mockResolvedValue(readyStatus);
    service.testMic.mockResolvedValue({ success: true, transcript: FAKE_SENTINEL_TRANSCRIPT });
    setupVoiceIPC(service as unknown as VoiceDictationService);

    await expect(invoke(IPC.VOICE.GET_PERMISSION_STATE)).resolves.toBe('granted');
    await expect(invoke(IPC.VOICE.OPEN_MIC_PREFERENCES)).resolves.toBeUndefined();
    await expect(invoke(IPC.VOICE.GET_MODEL_STATUS, VOICE_DICTATION_MODEL_ID)).resolves.toEqual(readyStatus);
    await expect(invoke(IPC.VOICE.CANCEL_DOWNLOAD, VOICE_DICTATION_MODEL_ID)).resolves.toBeUndefined();
    await expect(invoke(IPC.VOICE.TEST_MIC)).resolves.toEqual({
      success: true,
      transcript: FAKE_SENTINEL_TRANSCRIPT,
    });

    expect(service.openPreferences).toHaveBeenCalledOnce();
    expect(service.getModelStatus).toHaveBeenCalledWith(VOICE_DICTATION_MODEL_ID);
    expect(service.cancelDownload).toHaveBeenCalledWith(VOICE_DICTATION_MODEL_ID);
    expect(service.testMic).toHaveBeenCalledOnce();
  });

  it('forwards model download progress to the requesting webContents', async () => {
    const service = createMockService();
    const sender = createWebContents();
    service.downloadModel.mockImplementation(async (_modelId, progressCb) => {
      progressCb?.(readyStatus);
    });
    setupVoiceIPC(service as unknown as VoiceDictationService);

    await invokeWithSender(IPC.VOICE.DOWNLOAD_MODEL, sender, VOICE_DICTATION_MODEL_ID);

    expect(service.downloadModel).toHaveBeenCalledWith(VOICE_DICTATION_MODEL_ID, expect.any(Function));
    expect(sender.send).toHaveBeenCalledWith(IPC.VOICE.MODEL_PROGRESS, readyStatus);
  });

  it('starts sessions with a validated payload and forwards matching transcripts', async () => {
    const service = createMockService();
    const sender = createWebContents();
    setupVoiceIPC(service as unknown as VoiceDictationService);

    await invokeWithSender(IPC.VOICE.START_SESSION, sender, {
      sessionId: 'session-1',
      deviceId: 'mic-1',
      modelId: VOICE_DICTATION_MODEL_ID,
    });
    service.emitTranscript({ type: 'partial', sessionId: 'session-1', text: 'hello' });
    service.emitTranscript({ type: 'partial', sessionId: 'other-session', text: 'ignored' });

    expect(service.startSession).toHaveBeenCalledWith({
      sessionId: 'session-1',
      deviceId: 'mic-1',
      modelId: VOICE_DICTATION_MODEL_ID,
    });
    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(sender.send).toHaveBeenCalledWith(IPC.VOICE.TRANSCRIPT, {
      type: 'partial',
      sessionId: 'session-1',
      text: 'hello',
    });
  });

  it('supports the positional startSession preload shape while forwarding the normalized request', async () => {
    const service = createMockService();
    setupVoiceIPC(service as unknown as VoiceDictationService);

    await invoke(IPC.VOICE.START_SESSION, 'session-legacy', VOICE_DICTATION_MODEL_ID);

    expect(service.startSession).toHaveBeenCalledWith({
      sessionId: 'session-legacy',
      modelId: VOICE_DICTATION_MODEL_ID,
    });
  });

  it('validates appendAudio and forwards accepted chunks', async () => {
    const service = createMockService();
    const chunk = new Uint8Array([1, 2, 3]);
    setupVoiceIPC(service as unknown as VoiceDictationService);

    await invoke(IPC.VOICE.APPEND_AUDIO, 'session-1', chunk);

    expect(service.appendAudio).toHaveBeenCalledWith('session-1', chunk);
  });

  it('rejects oversize appendAudio chunks without calling the service', async () => {
    const service = createMockService();
    setupVoiceIPC(service as unknown as VoiceDictationService);

    await expect(
      invoke(IPC.VOICE.APPEND_AUDIO, 'session-1', new Uint8Array(VOICE_MAX_APPEND_CHUNK_BYTES + 1)),
    ).rejects.toThrow(/voice:appendAudio: invalid payload/);

    expect(service.appendAudio).not.toHaveBeenCalled();
  });

  it('rejects invalid session ids for session handlers', async () => {
    const service = createMockService();
    setupVoiceIPC(service as unknown as VoiceDictationService);

    await expect(invoke(IPC.VOICE.START_SESSION, { sessionId: '   ' })).rejects.toThrow(/non-empty string/);
    await expect(invoke(IPC.VOICE.APPEND_AUDIO, '', new Uint8Array())).rejects.toThrow(/non-empty string/);
    await expect(invoke(IPC.VOICE.END_SESSION, '')).rejects.toThrow(/non-empty string/);

    expect(service.startSession).not.toHaveBeenCalled();
    expect(service.appendAudio).not.toHaveBeenCalled();
    expect(service.endSession).not.toHaveBeenCalled();
  });

  it('unsubscribes transcript forwarding after endSession', async () => {
    const service = createMockService();
    const sender = createWebContents();
    setupVoiceIPC(service as unknown as VoiceDictationService);

    await invokeWithSender(IPC.VOICE.START_SESSION, sender, { sessionId: 'session-1' });
    await invokeWithSender(IPC.VOICE.END_SESSION, sender, 'session-1');
    service.emitTranscript({ type: 'final', sessionId: 'session-1', text: 'late', isFinal: true });

    expect(service.endSession).toHaveBeenCalledWith('session-1');
    expect(sender.send).not.toHaveBeenCalledWith(IPC.VOICE.TRANSCRIPT, expect.objectContaining({ text: 'late' }));
  });

  it('broadcasts transcript events to every webContents registered for the session', async () => {
    const service = createMockService();
    const firstSender = createWebContents();
    const secondSender = createWebContents();
    setupVoiceIPC(service as unknown as VoiceDictationService);

    await invokeWithSender(IPC.VOICE.START_SESSION, firstSender, { sessionId: 'shared-session' });
    await invokeWithSender(IPC.VOICE.START_SESSION, secondSender, { sessionId: 'shared-session' });
    service.emitTranscript({ type: 'final', sessionId: 'shared-session', text: 'done', isFinal: true });

    expect(firstSender.send).toHaveBeenCalledWith(IPC.VOICE.TRANSCRIPT, {
      type: 'final',
      sessionId: 'shared-session',
      text: 'done',
      isFinal: true,
    });
    expect(secondSender.send).toHaveBeenCalledWith(IPC.VOICE.TRANSCRIPT, {
      type: 'final',
      sessionId: 'shared-session',
      text: 'done',
      isFinal: true,
    });
  });

  it('returns null or feature-unavailable errors when featureEnabled is false', async () => {
    const service = createMockService();
    setupVoiceIPC(service as unknown as VoiceDictationService, { featureEnabled: false });

    await expect(invoke(IPC.VOICE.GET_CONFIG)).resolves.toBeNull();
    await expect(invoke(IPC.VOICE.GET_PERMISSION_STATE)).rejects.toThrow(/unavailable in this release channel/);
    await expect(invoke(IPC.VOICE.SAVE_CONFIG, validConfig)).rejects.toThrow(/unavailable in this release channel/);

    expect(service.getConfig).not.toHaveBeenCalled();
    expect(service.getPermissionState).not.toHaveBeenCalled();
    expect(service.saveConfig).not.toHaveBeenCalled();
  });

  it('registers e2e handlers only when e2eEnabled and forwards fake transcript events to the active session', async () => {
    setupVoiceIPC(createMockService() as unknown as VoiceDictationService);
    expect(registeredChannels()).not.toContain(IPC.E2E.VOICE_SET_FAKE_PROVIDER);
    expect(registeredChannels()).not.toContain(IPC.E2E.VOICE_EMIT_TRANSCRIPT);

    vi.mocked(ipcMain.handle).mockClear();
    const service = createMockService();
    const sender = createWebContents();
    setupVoiceIPC(service as unknown as VoiceDictationService, { e2eEnabled: true });

    expect(registeredChannels()).toContain(IPC.E2E.VOICE_SET_FAKE_PROVIDER);
    expect(registeredChannels()).toContain(IPC.E2E.VOICE_EMIT_TRANSCRIPT);

    await invoke(IPC.E2E.VOICE_SET_FAKE_PROVIDER);
    expect(service.setProviderForTesting).toHaveBeenCalledWith(expect.any(FakeTranscriptionProvider));

    await invokeWithSender(IPC.VOICE.START_SESSION, sender, { sessionId: 'session-1' });
    await invoke(IPC.E2E.VOICE_EMIT_TRANSCRIPT);

    expect(sender.send).toHaveBeenCalledWith(IPC.VOICE.TRANSCRIPT, {
      type: 'final',
      sessionId: 'session-1',
      text: FAKE_SENTINEL_TRANSCRIPT,
      isFinal: true,
    });
  });
});

function createMockService(): MockVoiceService {
  const listeners = new Set<(event: TranscriptionEvent) => void>();
  return {
    getConfig: vi.fn(async () => null),
    saveConfig: vi.fn(async () => undefined),
    getPermissionState: vi.fn(async () => 'not-determined'),
    openPreferences: vi.fn(async () => undefined),
    getModelStatus: vi.fn(async () => readyStatus),
    downloadModel: vi.fn(async () => undefined),
    cancelDownload: vi.fn(async () => undefined),
    startSession: vi.fn(async () => undefined),
    appendAudio: vi.fn(async () => undefined),
    endSession: vi.fn(async () => undefined),
    testMic: vi.fn(async () => ({ success: false, error: 'No transcript was produced.' })),
    subscribeTranscript: vi.fn((cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    }),
    setProviderForTesting: vi.fn(),
    emitTranscript: (event) => {
      for (const listener of listeners) {
        listener(event);
      }
    },
  };
}

let nextMockWebContentsId = 1;

function createWebContents(): MockWebContents {
  return {
    id: nextMockWebContentsId++,
    send: vi.fn(),
    once: vi.fn(),
    isDestroyed: vi.fn(() => false),
  };
}

function registeredChannels(): string[] {
  return vi.mocked(ipcMain.handle).mock.calls.map((call) => call[0]);
}

function getHandler(channel: string): IpcHandler {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(([registeredChannel]) => registeredChannel === channel);
  if (!call) {
    throw new Error(`Missing handler: ${channel}`);
  }
  const handler = call[1] as (...args: unknown[]) => Promise<unknown>;
  return (event, ...args) => handler(event, ...args);
}

function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  return invokeWithSender(channel, createWebContents(), ...args);
}

function invokeWithSender(channel: string, sender: MockWebContents, ...args: unknown[]): Promise<unknown> {
  return getHandler(channel)({ sender }, ...args);
}
