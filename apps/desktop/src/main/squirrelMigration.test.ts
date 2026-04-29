import { EventEmitter } from 'node:events';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ChildProcess } from 'node:child_process';

import { cleanupLegacySquirrelInstall } from './squirrelMigration';

function createFs(existingPaths: string[], removeFails = false) {
  const paths = new Set(existingPaths.map((entry) => path.normalize(entry)));
  return {
    existsSync: vi.fn((entry: string) => paths.has(path.normalize(entry))),
    rmSync: vi.fn((entry: string) => {
      if (removeFails) {
        throw new Error('locked');
      }
      paths.delete(path.normalize(entry));
    }),
  };
}

function createSpawn(exitCode: number | null) {
  return vi.fn(() => {
    const child = new EventEmitter() as ChildProcess;
    queueMicrotask(() => child.emit('exit', exitCode));
    return child;
  });
}

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
};

describe('cleanupLegacySquirrelInstall', () => {
  it('skips when the app is not a packaged Windows NSIS install', async () => {
    const result = await cleanupLegacySquirrelInstall({
      isPackaged: false,
      platform: 'win32',
      localAppData: 'C:\\Users\\test\\AppData\\Local',
      currentExecutable: 'C:\\Users\\test\\AppData\\Local\\Programs\\chamber\\chamber.exe',
      logger,
    });

    expect(result).toEqual({ status: 'skipped', reason: 'unsupported-runtime' });
  });

  it('skips when running from the legacy Squirrel install', async () => {
    const localAppData = 'C:\\Users\\test\\AppData\\Local';
    const legacyDir = path.join(localAppData, 'chamber');
    const fsImpl = createFs([legacyDir]);

    const result = await cleanupLegacySquirrelInstall({
      isPackaged: true,
      platform: 'win32',
      localAppData,
      currentExecutable: path.join(legacyDir, 'chamber.exe'),
      fsImpl,
      logger,
    });

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('running-from-legacy-install');
    expect(fsImpl.rmSync).not.toHaveBeenCalled();
  });

  it('runs Squirrel uninstall and removes leftover legacy files', async () => {
    const localAppData = 'C:\\Users\\test\\AppData\\Local';
    const legacyDir = path.join(localAppData, 'chamber');
    const updateExe = path.join(legacyDir, 'Update.exe');
    const fsImpl = createFs([legacyDir, updateExe]);
    const spawnFile = createSpawn(0);

    const result = await cleanupLegacySquirrelInstall({
      isPackaged: true,
      platform: 'win32',
      localAppData,
      currentExecutable: path.join(localAppData, 'Programs', 'chamber', 'chamber.exe'),
      fsImpl,
      spawnFile,
      logger,
    });

    expect(spawnFile).toHaveBeenCalledWith(updateExe, ['--uninstall'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    expect(fsImpl.rmSync).toHaveBeenCalledWith(legacyDir, { recursive: true, force: true });
    expect(result).toEqual({ status: 'cleaned', legacyDir, uninstallExitCode: 0 });
  });

  it('reports partial cleanup when leftover files cannot be removed', async () => {
    const localAppData = 'C:\\Users\\test\\AppData\\Local';
    const legacyDir = path.join(localAppData, 'chamber');
    const fsImpl = createFs([legacyDir], true);

    const result = await cleanupLegacySquirrelInstall({
      isPackaged: true,
      platform: 'win32',
      localAppData,
      currentExecutable: path.join(localAppData, 'Programs', 'chamber', 'chamber.exe'),
      fsImpl,
      logger,
    });

    expect(result.status).toBe('partial');
    expect(result.reason).toBe('legacy-dir-remove-failed');
    expect(result.error).toBe('locked');
  });
});
