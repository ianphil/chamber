import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function loadPrepareRuntime(): Promise<{
  assertHostMatchesTarget: (platform: string, arch: string) => void;
  getPlatformPackageName: (platform: string, arch: string) => string;
  promoteDirectory: (
    dirs: { stagingDir: string; targetDir: string; backupDir: string },
    fsImpl?: typeof fs,
  ) => void;
}> {
  const module = await import('../../scripts/prepare-copilot-runtime.js');
  return ('default' in module ? module.default : module) as {
    assertHostMatchesTarget: (platform: string, arch: string) => void;
    getPlatformPackageName: (platform: string, arch: string) => string;
    promoteDirectory: (
      dirs: { stagingDir: string; targetDir: string; backupDir: string },
      fsImpl?: typeof fs,
    ) => void;
  };
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
});
