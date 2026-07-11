import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function loadPrepareRuntime(): Promise<{
  assertHostMatchesTarget: (platform: string, arch: string) => void;
  createIsolatedCopilotEnvironment: (
    homeDir: string,
    baseEnv?: NodeJS.ProcessEnv,
  ) => NodeJS.ProcessEnv;
  getKeepPrebuildTriples: (platform: string, arch: string) => Set<string>;
  getPlatformPackageName: (platform: string, arch: string) => string;
  pruneForeignPrebuilds: (modulesDir: string, platform: string, arch: string) => string[];
  promoteDirectory: (
    dirs: { stagingDir: string; targetDir: string; backupDir: string },
    fsImpl?: typeof fs,
  ) => void;
}> {
  const module = await import('../../scripts/prepare-copilot-runtime.js');
  return ('default' in module ? module.default : module) as {
    assertHostMatchesTarget: (platform: string, arch: string) => void;
    createIsolatedCopilotEnvironment: (
      homeDir: string,
      baseEnv?: NodeJS.ProcessEnv,
    ) => NodeJS.ProcessEnv;
    getKeepPrebuildTriples: (platform: string, arch: string) => Set<string>;
    getPlatformPackageName: (platform: string, arch: string) => string;
    pruneForeignPrebuilds: (modulesDir: string, platform: string, arch: string) => string[];
    promoteDirectory: (
      dirs: { stagingDir: string; targetDir: string; backupDir: string },
      fsImpl?: typeof fs,
    ) => void;
  };
}

function seedPrebuilds(modulesDir: string, triples: string[]): string {
  const prebuildsDir = path.join(modulesDir, '@github', 'copilot', 'prebuilds');
  for (const triple of triples) {
    fs.mkdirSync(path.join(prebuildsDir, triple), { recursive: true });
    fs.writeFileSync(path.join(prebuildsDir, triple, 'runtime.node'), 'native');
  }
  return prebuildsDir;
}

describe('prepare-copilot-runtime', () => {
  it('builds the platform package name for a target tuple', async () => {
    const { getPlatformPackageName } = await loadPrepareRuntime();
    expect(getPlatformPackageName('win32', 'x64')).toBe('@github/copilot-win32-x64');
  });

  it('allows native-host packaging', async () => {
    const { assertHostMatchesTarget } = await loadPrepareRuntime();
    expect(() => assertHostMatchesTarget(process.platform, process.arch)).not.toThrow();
  });

  it('isolates runtime validation from the developer Copilot cache', async () => {
    const { createIsolatedCopilotEnvironment } = await loadPrepareRuntime();

    expect(createIsolatedCopilotEnvironment('C:\\temp\\copilot-home', {
      PATH: 'C:\\tools',
      HOME: 'C:\\Users\\developer',
      USERPROFILE: 'C:\\Users\\developer',
    })).toMatchObject({
      PATH: 'C:\\tools',
      HOME: 'C:\\temp\\copilot-home',
      USERPROFILE: 'C:\\temp\\copilot-home',
    });
  });

  it('rejects cross-compiling the Copilot runtime', async () => {
    const { assertHostMatchesTarget } = await loadPrepareRuntime();
    const otherPlatform = process.platform === 'win32' ? 'darwin' : 'win32';

    expect(() => assertHostMatchesTarget(otherPlatform, process.arch)).toThrow(
      'Cross-compiling the Copilot runtime is unsupported.'
    );
  });

  it('falls back to copying the staged runtime when Windows refuses directory promotion', async () => {
    const { promoteDirectory } = await loadPrepareRuntime();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-copilot-runtime-promote-'));
    const stagingDir = path.join(root, 'copilot-runtime.new');
    const targetDir = path.join(root, 'copilot-runtime');
    const backupDir = path.join(root, 'copilot-runtime.old');
    fs.mkdirSync(path.join(stagingDir, 'node_modules', '@github'), { recursive: true });
    fs.writeFileSync(path.join(stagingDir, 'node_modules', '@github', 'sentinel.txt'), 'ready');
    const fsWithLockedRename = {
      ...fs,
      renameSync: (oldPath: fs.PathLike, newPath: fs.PathLike) => {
        if (String(oldPath) === stagingDir && String(newPath) === targetDir) {
          throw Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' });
        }
        return fs.renameSync(oldPath, newPath);
      },
    } as typeof fs;

    try {
      promoteDirectory({ stagingDir, targetDir, backupDir }, fsWithLockedRename);

      expect(fs.readFileSync(path.join(targetDir, 'node_modules', '@github', 'sentinel.txt'), 'utf-8')).toBe('ready');
      expect(fs.existsSync(stagingDir)).toBe(false);
      expect(fs.existsSync(backupDir)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps only the host triple when pruning prebuilds on win32-x64', async () => {
    const { pruneForeignPrebuilds } = await loadPrepareRuntime();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-copilot-prune-'));
    const modulesDir = path.join(root, 'node_modules');
    const prebuildsDir = seedPrebuilds(modulesDir, [
      'win32-x64',
      'win32-arm64',
      'darwin-arm64',
      'darwin-x64',
      'linux-x64',
      'linux-arm64',
      'linuxmusl-x64',
      'linuxmusl-arm64',
    ]);

    try {
      const removed = pruneForeignPrebuilds(modulesDir, 'win32', 'x64');

      expect(removed.sort()).toEqual([
        'darwin-arm64',
        'darwin-x64',
        'linux-arm64',
        'linux-x64',
        'linuxmusl-arm64',
        'linuxmusl-x64',
        'win32-arm64',
      ]);
      expect(fs.readdirSync(prebuildsDir)).toEqual(['win32-x64']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps both glibc and musl prebuilds for a linux target', async () => {
    const { getKeepPrebuildTriples, pruneForeignPrebuilds } = await loadPrepareRuntime();
    expect(getKeepPrebuildTriples('linux', 'x64')).toEqual(new Set(['linux-x64', 'linuxmusl-x64']));

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-copilot-prune-linux-'));
    const modulesDir = path.join(root, 'node_modules');
    const prebuildsDir = seedPrebuilds(modulesDir, [
      'linux-x64',
      'linuxmusl-x64',
      'win32-x64',
      'darwin-arm64',
    ]);

    try {
      pruneForeignPrebuilds(modulesDir, 'linux', 'x64');
      expect(fs.readdirSync(prebuildsDir).sort()).toEqual(['linux-x64', 'linuxmusl-x64']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('leaves unrecognized prebuild directories untouched', async () => {
    const { pruneForeignPrebuilds } = await loadPrepareRuntime();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-copilot-prune-unknown-'));
    const modulesDir = path.join(root, 'node_modules');
    const prebuildsDir = seedPrebuilds(modulesDir, ['win32-x64', 'darwin-arm64']);
    fs.mkdirSync(path.join(prebuildsDir, 'README'), { recursive: true });
    fs.writeFileSync(path.join(prebuildsDir, 'index.json'), '{}');

    try {
      pruneForeignPrebuilds(modulesDir, 'win32', 'x64');
      expect(fs.readdirSync(prebuildsDir).sort()).toEqual(['README', 'index.json', 'win32-x64']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('is a no-op when no prebuilds directory exists', async () => {
    const { pruneForeignPrebuilds } = await loadPrepareRuntime();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-copilot-prune-empty-'));
    const modulesDir = path.join(root, 'node_modules');
    fs.mkdirSync(path.join(modulesDir, '@github', 'copilot'), { recursive: true });

    try {
      expect(pruneForeignPrebuilds(modulesDir, 'win32', 'x64')).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
