import { BrowserWindow, ipcMain, type WebContents } from 'electron';
import { z } from 'zod';

import {
  IPC,
  parseIpcArgs,
  VOICE_DICTATION_MODEL_ID,
  VOICE_MAX_APPEND_CHUNK_BYTES,
  type TranscriptionEvent,
  type VoiceDictationConfig,
  type VoiceMicTestResult,
  type VoiceModelStatus,
  type VoicePermissionState,
} from '@chamber/shared';
import { FAKE_SENTINEL_TRANSCRIPT, FakeTranscriptionProvider, type VoiceDictationService } from '@chamber/services';

export interface VoiceIpcOptions {
  featureEnabled?: boolean;
  /** When true, the e2e fake provider hooks are exposed. */
  e2eEnabled?: boolean;
}

interface VoiceStartSessionRequest {
  readonly sessionId: string;
  readonly deviceId?: string | null;
  readonly modelId?: string;
}

interface VoiceIpcServicePort {
  getConfig(): Promise<VoiceDictationConfig | null>;
  saveConfig(config: VoiceDictationConfig): Promise<void>;
  getPermissionState(): Promise<VoicePermissionState>;
  openPreferences(): Promise<void>;
  getModelStatus(modelId: string): Promise<VoiceModelStatus>;
  downloadModel(modelId: string, progressCb?: (status: VoiceModelStatus) => void): Promise<void>;
  cancelDownload(modelId: string): Promise<void>;
  startSession(sessionId: string, modelId?: string): Promise<void>;
  appendAudio(sessionId: string, chunk: Uint8Array): Promise<void>;
  endSession(sessionId: string): Promise<void>;
  testMic(): Promise<VoiceMicTestResult>;
  subscribeTranscript(cb: (event: TranscriptionEvent) => void): () => void;
  setProviderForTesting?(provider: FakeTranscriptionProvider): void | Promise<void>;
}

const nonEmptyStringSchema = z
  .string()
  .refine((value) => value.trim().length > 0, { message: 'must be a non-empty string' });

const optionalNonEmptyStringSchema = nonEmptyStringSchema.optional();

const modelIdSchema = nonEmptyStringSchema;

const configSchema = z
  .object({
    enabled: z.boolean(),
    inputDeviceId: z.string().nullable(),
    shortcut: z.string(),
    pushToTalk: z.boolean(),
    model: z
      .object({
        id: z.literal(VOICE_DICTATION_MODEL_ID),
        downloadedAt: z.string().optional(),
      })
      .strict(),
  })
  .strict();

const startSessionSchema = z
  .object({
    sessionId: nonEmptyStringSchema,
    deviceId: nonEmptyStringSchema.nullable().optional(),
    modelId: optionalNonEmptyStringSchema,
  })
  .strict();

const appendAudioSchema = z
  .object({
    sessionId: nonEmptyStringSchema,
    chunk: z
      .custom<Uint8Array>((value) => value instanceof Uint8Array, { message: 'must be a Uint8Array' })
      .refine((chunk) => chunk.byteLength <= VOICE_MAX_APPEND_CHUNK_BYTES, {
        message: `must be at most ${VOICE_MAX_APPEND_CHUNK_BYTES} bytes`,
      }),
  })
  .strict();

const e2eTranscriptSchema = z
  .object({
    type: z.enum(['partial', 'final', 'error', 'sessionStarted', 'sessionEnded']).optional(),
    text: z.string().optional(),
    message: z.string().optional(),
  })
  .strict()
  .optional();

export function setupVoiceIPC(service: VoiceDictationService, options: VoiceIpcOptions = {}): void {
  const featureEnabled = options.featureEnabled ?? true;
  const voiceService = service as unknown as VoiceIpcServicePort;
  const transcriptTargets = new Map<string, Set<WebContents>>();
  const transcriptUnsubscribes = new Map<string, () => void>();
  let activeSessionId: string | null = null;

  function requireFeatureEnabled(): void {
    if (!featureEnabled) {
      throw new Error(featureUnavailableMessage());
    }
  }

  function addTranscriptTarget(sessionId: string, webContents: WebContents): void {
    const targets = transcriptTargets.get(sessionId) ?? new Set<WebContents>();
    targets.add(webContents);
    transcriptTargets.set(sessionId, targets);

    if (!transcriptUnsubscribes.has(sessionId)) {
      const unsubscribe = voiceService.subscribeTranscript((event) => {
        if (event.sessionId !== sessionId) return;
        forwardTranscript(sessionId, event);
      });
      transcriptUnsubscribes.set(sessionId, unsubscribe);
    }
  }

  function removeTranscriptSession(sessionId: string): void {
    transcriptUnsubscribes.get(sessionId)?.();
    transcriptUnsubscribes.delete(sessionId);
    transcriptTargets.delete(sessionId);
    if (activeSessionId === sessionId) activeSessionId = null;
  }

  function forwardTranscript(sessionId: string, event: TranscriptionEvent): void {
    const targets = transcriptTargets.get(sessionId);
    if (!targets) return;
    const payload = { ...event, sessionId };
    for (const target of targets) {
      target.send(IPC.VOICE.TRANSCRIPT, payload);
    }
  }

  ipcMain.handle(IPC.VOICE.GET_CONFIG, async (): Promise<VoiceDictationConfig | null> => {
    if (!featureEnabled) return null;
    return voiceService.getConfig();
  });

  ipcMain.handle(IPC.VOICE.SAVE_CONFIG, async (_event, rawConfig: unknown): Promise<void> => {
    requireFeatureEnabled();
    const config = parseIpcArgs(IPC.VOICE.SAVE_CONFIG, configSchema, rawConfig) as VoiceDictationConfig;
    await voiceService.saveConfig(config);
    broadcastConfigChanged(config);
  });

  ipcMain.handle(IPC.VOICE.GET_PERMISSION_STATE, async (): Promise<VoicePermissionState> => {
    requireFeatureEnabled();
    return voiceService.getPermissionState();
  });

  ipcMain.handle(IPC.VOICE.OPEN_MIC_PREFERENCES, async (): Promise<void> => {
    requireFeatureEnabled();
    await voiceService.openPreferences();
  });

  ipcMain.handle(IPC.VOICE.GET_MODEL_STATUS, async (_event, rawModelId: unknown): Promise<VoiceModelStatus> => {
    requireFeatureEnabled();
    const modelId = parseIpcArgs(IPC.VOICE.GET_MODEL_STATUS, modelIdSchema, rawModelId);
    return voiceService.getModelStatus(modelId);
  });

  ipcMain.handle(IPC.VOICE.DOWNLOAD_MODEL, async (event, rawModelId: unknown): Promise<void> => {
    requireFeatureEnabled();
    const modelId = parseIpcArgs(IPC.VOICE.DOWNLOAD_MODEL, modelIdSchema, rawModelId);
    await voiceService.downloadModel(modelId, (status) => {
      event.sender.send(IPC.VOICE.MODEL_PROGRESS, status);
    });
  });

  ipcMain.handle(IPC.VOICE.CANCEL_DOWNLOAD, async (_event, rawModelId: unknown): Promise<void> => {
    requireFeatureEnabled();
    const modelId = parseIpcArgs(IPC.VOICE.CANCEL_DOWNLOAD, modelIdSchema, rawModelId);
    await voiceService.cancelDownload(modelId);
  });

  ipcMain.handle(
    IPC.VOICE.START_SESSION,
    async (event, rawRequestOrSessionId: unknown, rawModelId?: unknown, rawDeviceId?: unknown): Promise<void> => {
      requireFeatureEnabled();
      const request = parseIpcArgs(
        IPC.VOICE.START_SESSION,
        startSessionSchema,
        normalizeStartSessionPayload(rawRequestOrSessionId, rawModelId, rawDeviceId),
      ) as VoiceStartSessionRequest;
      addTranscriptTarget(request.sessionId, event.sender);
      try {
        await voiceService.startSession(request.sessionId, request.modelId);
        activeSessionId = request.sessionId;
      } catch (err) {
        removeTranscriptSession(request.sessionId);
        throw err;
      }
    },
  );

  ipcMain.handle(IPC.VOICE.APPEND_AUDIO, async (_event, rawPayloadOrSessionId: unknown, rawChunk?: unknown): Promise<void> => {
    requireFeatureEnabled();
    const { sessionId, chunk } = parseIpcArgs(
      IPC.VOICE.APPEND_AUDIO,
      appendAudioSchema,
      normalizeAppendAudioPayload(rawPayloadOrSessionId, rawChunk),
    );
    await voiceService.appendAudio(sessionId, chunk);
  });

  ipcMain.handle(IPC.VOICE.END_SESSION, async (_event, rawPayloadOrSessionId: unknown): Promise<void> => {
    requireFeatureEnabled();
    const sessionId = parseIpcArgs(
      IPC.VOICE.END_SESSION,
      nonEmptyStringSchema,
      normalizeEndSessionPayload(rawPayloadOrSessionId),
    );
    try {
      await voiceService.endSession(sessionId);
    } finally {
      removeTranscriptSession(sessionId);
    }
  });

  ipcMain.handle(IPC.VOICE.TEST_MIC, async (): Promise<VoiceMicTestResult> => {
    requireFeatureEnabled();
    return voiceService.testMic();
  });

  if (options.e2eEnabled === true) {
    ipcMain.handle(IPC.E2E.VOICE_SET_FAKE_PROVIDER, async (): Promise<void> => {
      requireFeatureEnabled();
      await voiceService.setProviderForTesting?.(new FakeTranscriptionProvider());
    });

    ipcMain.handle(IPC.E2E.VOICE_EMIT_TRANSCRIPT, async (_event, rawPayload?: unknown): Promise<void> => {
      requireFeatureEnabled();
      if (!activeSessionId) {
        throw new Error('No active voice dictation session');
      }
      const payload = parseIpcArgs(IPC.E2E.VOICE_EMIT_TRANSCRIPT, e2eTranscriptSchema, rawPayload);
      forwardTranscript(activeSessionId, createE2ETranscriptEvent(activeSessionId, payload));
    });
  }
}

function normalizeStartSessionPayload(
  rawRequestOrSessionId: unknown,
  rawModelId: unknown,
  rawDeviceId: unknown,
): unknown {
  if (isRecord(rawRequestOrSessionId)) return rawRequestOrSessionId;
  return {
    sessionId: rawRequestOrSessionId,
    ...(typeof rawModelId !== 'undefined' ? { modelId: rawModelId } : {}),
    ...(typeof rawDeviceId !== 'undefined' ? { deviceId: rawDeviceId } : {}),
  };
}

function normalizeAppendAudioPayload(rawPayloadOrSessionId: unknown, rawChunk: unknown): unknown {
  if (isRecord(rawPayloadOrSessionId)) return rawPayloadOrSessionId;
  return {
    sessionId: rawPayloadOrSessionId,
    chunk: rawChunk,
  };
}

function normalizeEndSessionPayload(rawPayloadOrSessionId: unknown): unknown {
  if (isRecord(rawPayloadOrSessionId)) return rawPayloadOrSessionId.sessionId;
  return rawPayloadOrSessionId;
}

function broadcastConfigChanged(config: VoiceDictationConfig | null): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.VOICE.CHANGED, config);
  }
}

function featureUnavailableMessage(): string {
  return 'Voice dictation is unavailable in this release channel';
}

function createE2ETranscriptEvent(
  sessionId: string,
  payload: z.infer<typeof e2eTranscriptSchema>,
): TranscriptionEvent {
  const type = payload?.type ?? 'final';
  if (type === 'partial') {
    return { type, sessionId, text: payload?.text ?? 'hello chamber' };
  }
  if (type === 'error') {
    return { type, sessionId, message: payload?.message ?? 'Fake voice dictation error' };
  }
  if (type === 'sessionStarted' || type === 'sessionEnded') {
    return { type, sessionId };
  }
  return { type: 'final', sessionId, text: payload?.text ?? FAKE_SENTINEL_TRANSCRIPT, isFinal: true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
