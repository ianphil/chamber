import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  VOICE_DICTATION_MODEL_ID,
  type VoiceDictationConfig,
  type VoiceDictationModelConfig,
} from '@chamber/shared/voice-types';
import { getErrorMessage } from '@chamber/shared/getErrorMessage';
import { Logger } from '../logger';

const log = Logger.create('VoiceDictationStore');
const FILE_NAME = 'voice-dictation.json';

export interface VoiceDictationStoreOptions {
  readonly storeDir?: string;
}

export class VoiceDictationStore {
  private readonly storeDir: string;
  private readonly filePath: string;

  constructor(options: VoiceDictationStoreOptions = {}) {
    this.storeDir = options.storeDir ?? path.join(os.homedir(), '.chamber');
    this.filePath = path.join(this.storeDir, FILE_NAME);
  }

  getFilePath(): string {
    return this.filePath;
  }

  async load(): Promise<VoiceDictationConfig | null> {
    try {
      const raw = await fs.promises.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as unknown;
      const config = coerceVoiceDictationConfig(parsed);
      if (!config) {
        log.warn(`Stored voice dictation config at ${this.filePath} is invalid; ignoring.`);
        return null;
      }
      return config;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') return null;
      log.warn(`Failed to read voice dictation config from ${this.filePath}: ${getErrorMessage(err)}`);
      return null;
    }
  }

  async save(config: VoiceDictationConfig): Promise<void> {
    const sanitized = coerceVoiceDictationConfig(config);
    if (!sanitized) {
      throw new Error('Refusing to save invalid voice dictation config');
    }
    await this.writeConfig(sanitized);
    log.info(`Saved voice dictation config enabled=${sanitized.enabled} model=${sanitized.model.id}`);
  }

  async clear(): Promise<void> {
    try {
      await fs.promises.unlink(this.filePath);
      log.info('Cleared voice dictation config');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') return;
      throw err;
    }
  }

  private async writeConfig(config: VoiceDictationConfig): Promise<void> {
    await fs.promises.mkdir(this.storeDir, { recursive: true });
    const tempPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    const data = JSON.stringify(config, null, 2);
    const fh = await fs.promises.open(tempPath, 'w');
    try {
      await fh.writeFile(data, 'utf-8');
      await fh.sync();
    } finally {
      await fh.close();
    }

    try {
      await fs.promises.rename(tempPath, this.filePath);
    } catch (err) {
      await fs.promises.rm(tempPath, { force: true });
      throw err;
    }
  }
}

export function coerceVoiceDictationConfig(input: unknown): VoiceDictationConfig | null {
  if (!isRecord(input)) return null;
  if (typeof input.enabled !== 'boolean') return null;
  if (input.inputDeviceId !== null && typeof input.inputDeviceId !== 'string') return null;
  if (typeof input.shortcut !== 'string') return null;
  if (typeof input.pushToTalk !== 'boolean') return null;

  const model = coerceVoiceDictationModelConfig(input.model);
  if (!model) return null;

  return {
    enabled: input.enabled,
    inputDeviceId: input.inputDeviceId,
    shortcut: input.shortcut,
    pushToTalk: input.pushToTalk,
    model,
  };
}

function coerceVoiceDictationModelConfig(input: unknown): VoiceDictationModelConfig | null {
  if (!isRecord(input)) return null;
  if (input.id !== VOICE_DICTATION_MODEL_ID) return null;

  return {
    id: VOICE_DICTATION_MODEL_ID,
    ...(typeof input.downloadedAt === 'string' ? { downloadedAt: input.downloadedAt } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
