import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { VOICE_DICTATION_MODEL_ID, type VoiceDictationConfig } from '@chamber/shared/voice-types';
import { VoiceDictationStore } from './VoiceDictationStore';

const TEST_ROOT = path.join(process.cwd(), '.cache', 'voice-dictation-store-tests');

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

describe('VoiceDictationStore', () => {
  let storeDir: string;
  let store: VoiceDictationStore;

  beforeEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    storeDir = path.join(TEST_ROOT, `case-${Date.now()}`);
    store = new VoiceDictationStore({ storeDir });
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('returns null when the config file does not exist', async () => {
    await expect(store.load()).resolves.toBeNull();
  });

  it('returns null for corrupt or invalid config files', async () => {
    fs.mkdirSync(storeDir, { recursive: true });
    fs.writeFileSync(store.getFilePath(), '{ bad json', 'utf-8');
    await expect(store.load()).resolves.toBeNull();

    fs.writeFileSync(store.getFilePath(), JSON.stringify({ enabled: true }), 'utf-8');
    await expect(store.load()).resolves.toBeNull();
  });

  it('round-trips a valid config and strips unknown fields from disk', async () => {
    const config = createConfig({
      inputDeviceId: 'mic-1',
      model: {
        id: VOICE_DICTATION_MODEL_ID,
        downloadedAt: '2026-06-09T21:00:00.000Z',
      },
    });

    await store.save(config);

    expect(await store.load()).toEqual(config);
    expect(JSON.parse(fs.readFileSync(store.getFilePath(), 'utf-8'))).toEqual(config);
  });

  it('loads only valid known fields and drops sensitive-looking unknown data', async () => {
    fs.mkdirSync(storeDir, { recursive: true });
    fs.writeFileSync(
      store.getFilePath(),
      JSON.stringify({
        enabled: true,
        inputDeviceId: 'mic-1',
        shortcut: 'Alt+Shift+V',
        pushToTalk: true,
        transcript: 'do not persist transcripts',
        apiKey: 'do-not-persist',
        model: {
          id: VOICE_DICTATION_MODEL_ID,
          status: 'error',
          sizeBytes: 123,
          errorMessage: 'download failed',
          progress: 42,
          downloadedAt: '2026-06-09T21:00:00.000Z',
        },
      }),
      'utf-8',
    );

    expect(await store.load()).toEqual({
      enabled: true,
      inputDeviceId: 'mic-1',
      shortcut: 'Alt+Shift+V',
      pushToTalk: true,
      model: {
        id: VOICE_DICTATION_MODEL_ID,
        downloadedAt: '2026-06-09T21:00:00.000Z',
      },
    });
  });

  it('uses atomic write without leaving tmp files behind', async () => {
    await store.save(createConfig());

    expect(fs.readdirSync(storeDir)).toEqual(['voice-dictation.json']);
  });

  it('clears the persisted config idempotently', async () => {
    await store.save(createConfig());
    expect(fs.existsSync(store.getFilePath())).toBe(true);

    await store.clear();
    await store.clear();

    expect(fs.existsSync(store.getFilePath())).toBe(false);
  });

  it('rejects invalid configs on save', async () => {
    await expect(store.save({
      ...createConfig(),
      model: { id: 'unknown-model' },
    } as unknown as VoiceDictationConfig)).rejects.toThrow(/invalid voice dictation config/i);
  });
});
