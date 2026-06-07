import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_APP_FEATURE_FLAGS, type AppFeatureFlags } from '@chamber/shared/feature-flags';
import { FeatureFlagService } from './FeatureFlagService';

const DEV_FLAGS: AppFeatureFlags = {
  switchboardRelay: true,
  byoLlm: false,
  chamberCopilot: true,
  azureSpeech: false,
};

const REMOTE_FLAGS: AppFeatureFlags = {
  switchboardRelay: true,
  byoLlm: true,
  chamberCopilot: false,
  azureSpeech: false,
};

describe('FeatureFlagService', () => {
  it('uses committed dev flags for unpackaged runs without fetching remote policy', async () => {
    let fetched = false;
    const service = new FeatureFlagService({
      version: '0.62.4',
      isPackaged: false,
      userDataPath: await tempDir(),
      devFeatureFlags: DEV_FLAGS,
      fetchImpl: async () => {
        fetched = true;
        throw new Error('unexpected fetch');
      },
    });

    await expect(service.initialize()).resolves.toEqual(DEV_FLAGS);
    expect(fetched).toBe(false);
  });

  it('uses remote channel flags for packaged insiders and caches them', async () => {
    const userDataPath = await tempDir();
    const service = new FeatureFlagService({
      version: '0.62.4-insiders.3',
      isPackaged: true,
      userDataPath,
      devFeatureFlags: DEV_FLAGS,
      fetchImpl: jsonFetch({
        version: 1,
        channels: {
          stable: DEFAULT_APP_FEATURE_FLAGS,
          insiders: REMOTE_FLAGS,
        },
      }),
    });

    await expect(service.initialize()).resolves.toEqual(REMOTE_FLAGS);
    await expect(fs.readFile(path.join(userDataPath, 'feature-flags', 'insiders.json'), 'utf-8'))
      .resolves.toContain('"byoLlm": true');
  });

  it('falls back to cached channel flags when packaged fetch fails', async () => {
    const userDataPath = await tempDir();
    await seedCache(userDataPath, 'stable', REMOTE_FLAGS);
    const service = new FeatureFlagService({
      version: '0.62.4',
      isPackaged: true,
      userDataPath,
      devFeatureFlags: DEV_FLAGS,
      fetchImpl: async () => new Response('nope', { status: 500 }),
    });

    await expect(service.initialize()).resolves.toEqual(REMOTE_FLAGS);
  });

  it('falls back to safe defaults when packaged fetch and cache are unavailable', async () => {
    const service = new FeatureFlagService({
      version: '0.62.4-insiders.3',
      isPackaged: true,
      userDataPath: await tempDir(),
      devFeatureFlags: DEV_FLAGS,
      fetchImpl: async () => new Response('nope', { status: 500 }),
    });

    await expect(service.initialize()).resolves.toEqual(DEFAULT_APP_FEATURE_FLAGS);
  });

  it('falls back to safe defaults when remote and cached policies are malformed', async () => {
    const userDataPath = await tempDir();
    await seedCache(userDataPath, 'stable', { broken: true });
    const service = new FeatureFlagService({
      version: '0.62.4',
      isPackaged: true,
      userDataPath,
      devFeatureFlags: DEV_FLAGS,
      fetchImpl: jsonFetch({ version: 1, channels: { stable: null, insiders: REMOTE_FLAGS } }),
    });

    await expect(service.initialize()).resolves.toEqual(DEFAULT_APP_FEATURE_FLAGS);
  });

  it('honors the E2E preview override without fetching remote policy', async () => {
    let fetched = false;
    const service = new FeatureFlagService({
      version: '0.62.4',
      isPackaged: true,
      userDataPath: await tempDir(),
      devFeatureFlags: DEV_FLAGS,
      previewFeatures: true,
      fetchImpl: async () => {
        fetched = true;
        throw new Error('unexpected fetch');
      },
    });

    await expect(service.initialize()).resolves.toEqual({
      switchboardRelay: true,
      byoLlm: true,
      chamberCopilot: true,
      azureSpeech: true,
    });
    expect(fetched).toBe(false);
  });
});

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'chamber-feature-flags-'));
}

function jsonFetch(value: unknown): typeof fetch {
  return async () => Response.json(value);
}

async function seedCache(userDataPath: string, channel: string, flags: unknown): Promise<void> {
  const cacheDir = path.join(userDataPath, 'feature-flags');
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(path.join(cacheDir, `${channel}.json`), JSON.stringify({ version: 1, flags }));
}
