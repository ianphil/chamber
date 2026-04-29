import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export type SquirrelMigrationStatus =
  | 'skipped'
  | 'cleaned'
  | 'partial'
  | 'failed';

export interface SquirrelMigrationResult {
  readonly status: SquirrelMigrationStatus;
  readonly reason?: string;
  readonly legacyDir?: string;
  readonly uninstallExitCode?: number | null;
  readonly error?: string;
}

export interface SquirrelMigrationLogger {
  info: (message: string) => void;
  warn: (message: string) => void;
}

interface SpawnedProcess {
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'exit', listener: (code: number | null) => void): this;
}

type SpawnFile = (
  command: string,
  args: string[],
  options: { windowsHide: true; stdio: 'ignore' },
) => SpawnedProcess;

interface SquirrelMigrationFs {
  existsSync(path: string): boolean;
  rmSync(path: string, options: { recursive: true; force: true }): void;
}

export interface SquirrelMigrationOptions {
  readonly isPackaged: boolean;
  readonly platform?: NodeJS.Platform;
  readonly localAppData?: string;
  readonly currentExecutable?: string;
  readonly logger?: SquirrelMigrationLogger;
  readonly spawnFile?: SpawnFile;
  readonly fsImpl?: SquirrelMigrationFs;
}

function isWithinDirectory(candidate: string, parent: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative.length === 0 || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function runSquirrelUninstall(
  updateExe: string,
  spawnFile: SpawnFile,
): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawnFile(updateExe, ['--uninstall'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code));
  });
}

export async function cleanupLegacySquirrelInstall(
  options: SquirrelMigrationOptions,
): Promise<SquirrelMigrationResult> {
  const platform = options.platform ?? process.platform;
  if (!options.isPackaged || platform !== 'win32') {
    return { status: 'skipped', reason: 'unsupported-runtime' };
  }

  const localAppData = options.localAppData ?? process.env.LOCALAPPDATA;
  if (!localAppData) {
    return { status: 'skipped', reason: 'missing-localappdata' };
  }

  const fsImpl = options.fsImpl ?? fs;
  const spawnFile = options.spawnFile ?? spawn;
  const logger = options.logger ?? console;
  const currentExecutable = options.currentExecutable ?? process.execPath;
  const legacyDir = path.join(localAppData, 'chamber');
  const updateExe = path.join(legacyDir, 'Update.exe');

  if (!fsImpl.existsSync(legacyDir)) {
    return { status: 'skipped', reason: 'legacy-install-missing', legacyDir };
  }

  if (isWithinDirectory(currentExecutable, legacyDir)) {
    return { status: 'skipped', reason: 'running-from-legacy-install', legacyDir };
  }

  let uninstallExitCode: number | null | undefined;
  if (fsImpl.existsSync(updateExe)) {
    try {
      uninstallExitCode = await runSquirrelUninstall(updateExe, spawnFile);
      logger.info(`[squirrel-migration] Legacy Squirrel uninstall exited with ${uninstallExitCode ?? 'null'}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`[squirrel-migration] Legacy Squirrel uninstall failed: ${message}`);
      return {
        status: 'failed',
        reason: 'uninstall-failed',
        legacyDir,
        error: message,
      };
    }
  }

  if (!fsImpl.existsSync(legacyDir)) {
    return { status: 'cleaned', legacyDir, uninstallExitCode };
  }

  try {
    fsImpl.rmSync(legacyDir, { recursive: true, force: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`[squirrel-migration] Could not remove legacy Squirrel directory: ${message}`);
    return {
      status: 'partial',
      reason: 'legacy-dir-remove-failed',
      legacyDir,
      uninstallExitCode,
      error: message,
    };
  }

  if (fsImpl.existsSync(legacyDir)) {
    return {
      status: 'partial',
      reason: 'legacy-dir-remains',
      legacyDir,
      uninstallExitCode,
    };
  }

  return { status: 'cleaned', legacyDir, uninstallExitCode };
}
