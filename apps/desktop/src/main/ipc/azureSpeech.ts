// Azure Speech IPC handlers — get/save/disable/test/mintToken flow for the
// voice (speech-to-text + text-to-speech) surface in Settings and chat.
//
// The renderer never receives the subscription key: GET returns a masked
// config and MINT_TOKEN returns only a short-lived Azure authorization token.

import { ipcMain, BrowserWindow } from 'electron';
import { getErrorMessage } from '@chamber/shared/getErrorMessage';
import { IPC } from '@chamber/shared';
import type {
  AzureSpeechConfig,
  AzureSpeechSaveResult,
  AzureSpeechTestResult,
  AzureSpeechToken,
} from '@chamber/shared/types';
import { AzureSpeechStore, Logger } from '@chamber/services';

const log = Logger.create('AzureSpeech');

const MASKED_SECRET = '********';

function redactConfigForRenderer(config: AzureSpeechConfig | null): AzureSpeechConfig | null {
  if (!config) return null;
  const redacted: AzureSpeechConfig = { ...config };
  if (redacted.apiKey) redacted.apiKey = MASKED_SECRET;
  return redacted;
}

function broadcast(config: AzureSpeechConfig | null): void {
  const rendererConfig = redactConfigForRenderer(config);
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.AZURE_SPEECH.CHANGED, rendererConfig);
  }
}

/** Resolve a masked key back to the stored secret before persisting/testing. */
async function hydrateMaskedKey(store: AzureSpeechStore, config: AzureSpeechConfig): Promise<AzureSpeechConfig> {
  if (config.apiKey !== MASKED_SECRET) return config;
  const current = await store.load();
  const hydrated: AzureSpeechConfig = { ...config };
  if (current?.apiKey) hydrated.apiKey = current.apiKey;
  else delete hydrated.apiKey;
  return hydrated;
}

export interface AzureSpeechIpcOptions {
  featureEnabled?: boolean;
}

export function setupAzureSpeechIPC(
  store: AzureSpeechStore,
  options: AzureSpeechIpcOptions = {},
): void {
  const featureEnabled = options.featureEnabled ?? true;

  ipcMain.handle(IPC.AZURE_SPEECH.GET, async (): Promise<AzureSpeechConfig | null> => {
    if (!featureEnabled) return null;
    return redactConfigForRenderer(await store.load());
  });

  ipcMain.handle(IPC.AZURE_SPEECH.SAVE, async (_event, config: AzureSpeechConfig): Promise<AzureSpeechSaveResult> => {
    if (!featureEnabled) return featureUnavailableSaveResult();
    try {
      if (!config || typeof config !== 'object') {
        return { success: false, error: 'Invalid config payload' };
      }
      if (config.enabled && (!config.region || !config.region.trim())) {
        return { success: false, error: 'Region is required when enabling voice' };
      }
      const hydrated = await hydrateMaskedKey(store, config);
      if (hydrated.enabled && !hydrated.apiKey) {
        return { success: false, error: 'Subscription key is required when enabling voice' };
      }
      await store.save(hydrated);
      const saved = await store.load();
      broadcast(saved);
      return { success: true };
    } catch (err) {
      const message = getErrorMessage(err);
      log.error('Failed to save Azure Speech config:', message);
      return { success: false, error: message };
    }
  });

  ipcMain.handle(IPC.AZURE_SPEECH.DISABLE, async (): Promise<AzureSpeechSaveResult> => {
    if (!featureEnabled) return featureUnavailableSaveResult();
    try {
      await store.clear();
      broadcast(null);
      return { success: true };
    } catch (err) {
      const message = getErrorMessage(err);
      log.error('Failed to disable Azure Speech config:', message);
      return { success: false, error: message };
    }
  });

  ipcMain.handle(IPC.AZURE_SPEECH.TEST, async (_event, config: AzureSpeechConfig): Promise<AzureSpeechTestResult> => {
    if (!featureEnabled) return { ok: false, error: featureUnavailableMessage() };
    try {
      const hydrated = config ? await hydrateMaskedKey(store, config) : undefined;
      return store.testConnection(hydrated ? { region: hydrated.region, apiKey: hydrated.apiKey } : undefined);
    } catch (err) {
      return { ok: false, error: getErrorMessage(err) };
    }
  });

  ipcMain.handle(IPC.AZURE_SPEECH.MINT_TOKEN, async (): Promise<AzureSpeechToken | null> => {
    if (!featureEnabled) return null;
    try {
      return await store.mintToken();
    } catch (err) {
      log.warn('Failed to mint Azure Speech token:', getErrorMessage(err));
      return null;
    }
  });
}

function featureUnavailableMessage(): string {
  return 'Voice is unavailable in this release channel';
}

function featureUnavailableSaveResult(): AzureSpeechSaveResult {
  return { success: false, error: featureUnavailableMessage() };
}
