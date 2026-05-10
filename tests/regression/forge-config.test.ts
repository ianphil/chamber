import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import config from '../../forge.config';
import packageJson from '../../package.json';

interface ForgeMakerWithConfig {
  name: string;
  config?: Record<string, unknown>;
  prepareConfig: (targetArch: string) => Promise<void>;
  constructor: {
    name: string;
  };
}

async function getSquirrelMakerConfig(): Promise<Record<string, unknown>> {
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
  it('configures a Windows icon for the app package and Squirrel setup shortcut flow', async () => {
    const appIcon = path.resolve(__dirname, '..', '..', 'assets', 'app');
    const setupIcon = `${appIcon}.ico`;
    const squirrelConfig = await getSquirrelMakerConfig();

    expect(packageJson.productName).toBe('Chamber');
    expect(config.packagerConfig?.icon).toBe(appIcon);
    expect(squirrelConfig.name).toBe('chamber');
    expect(squirrelConfig.title).toBe('Chamber');
    expect(squirrelConfig.setupIcon).toBe(setupIcon);
    expect(fs.readFileSync(setupIcon).subarray(0, 4)).toEqual(Buffer.from([0, 0, 1, 0]));
  });
});
