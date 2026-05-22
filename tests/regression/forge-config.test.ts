import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import packageJson from '../../package.json';

interface ForgeMakerWithConfig {
  name: string;
  config?: Record<string, unknown>;
  prepareConfig: (targetArch: string) => Promise<void>;
  constructor: {
    name: string;
  };
}

async function loadForgeConfig() {
  // forge.config.ts reads process.env.CHAMBER_MVP_SERVER at module-load to
  // decide whether to ship the server bundle as an Electron resource (#145).
  // resetModules() drops the cached evaluation so each test sees the env it
  // arranged in beforeEach.
  vi.resetModules();
  const mod = await import('../../forge.config');
  return mod.default;
}

async function getSquirrelMakerConfig(): Promise<Record<string, unknown>> {
  const config = await loadForgeConfig();
  const makers = config.makers ?? [];
  const squirrelMaker = makers.find((maker) => {
    const candidate = maker as unknown as ForgeMakerWithConfig;
    return candidate.name === '@electron-forge/maker-squirrel' || candidate.constructor.name === 'MakerSquirrel';
  }) as ForgeMakerWithConfig | undefined;

  expect(squirrelMaker).toBeDefined();
  if (!squirrelMaker) {
    throw new Error('Squirrel maker is not configured.');
  }

  await squirrelMaker.prepareConfig(process.arch);
  return squirrelMaker.config ?? {};
}

describe('forge config', () => {
  const originalMvpServerEnv = process.env.CHAMBER_MVP_SERVER;

  beforeEach(() => {
    delete process.env.CHAMBER_MVP_SERVER;
  });

  afterEach(() => {
    if (originalMvpServerEnv === undefined) {
      delete process.env.CHAMBER_MVP_SERVER;
    } else {
      process.env.CHAMBER_MVP_SERVER = originalMvpServerEnv;
    }
  });

  it('configures a Windows icon for the app package and Squirrel setup shortcut flow', async () => {
    const appIcon = path.resolve(__dirname, '..', '..', 'assets', 'app');
    const setupIcon = `${appIcon}.ico`;
    const config = await loadForgeConfig();
    const squirrelConfig = await getSquirrelMakerConfig();

    expect(packageJson.productName).toBe('Chamber');
    expect(config.packagerConfig?.icon).toBe(appIcon);
    expect(squirrelConfig.name).toBe('chamber');
    expect(squirrelConfig.title).toBe('Chamber');
    expect(squirrelConfig.setupIcon).toBe(setupIcon);
    expect(fs.readFileSync(setupIcon).subarray(0, 4)).toEqual(Buffer.from([0, 0, 1, 0]));
  });

  describe('MVP loopback server resource (#145)', () => {
    it('does NOT ship apps/server/dist as an extraResource by default — saves installer bytes when the runtime gate is off', async () => {
      delete process.env.CHAMBER_MVP_SERVER;
      const config = await loadForgeConfig();
      const extraResource = config.packagerConfig?.extraResource ?? [];
      expect(Array.isArray(extraResource)).toBe(true);
      expect(extraResource).not.toContain('./apps/server/dist');
    });

    it('SHIPS apps/server/dist when CHAMBER_MVP_SERVER=1 is set at package time', async () => {
      process.env.CHAMBER_MVP_SERVER = '1';
      const config = await loadForgeConfig();
      const extraResource = config.packagerConfig?.extraResource ?? [];
      expect(extraResource).toContain('./apps/server/dist');
    });

    it('continues to ship the non-server resources unconditionally', async () => {
      delete process.env.CHAMBER_MVP_SERVER;
      const config = await loadForgeConfig();
      const extraResource = (config.packagerConfig?.extraResource ?? []) as string[];
      // These resources are always required for the packaged app.
      expect(extraResource).toContain('./resources/node');
      expect(extraResource).toContain('./resources/copilot-runtime');
      expect(extraResource).toContain('./resources/sqlite-runtime');
      expect(extraResource).toContain('./node_modules/keytar');
    });
  });
});
