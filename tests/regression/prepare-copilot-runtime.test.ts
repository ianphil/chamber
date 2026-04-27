import { describe, expect, it } from 'vitest';

async function loadPrepareRuntime(): Promise<{
  assertHostMatchesTarget: (platform: string, arch: string) => void;
  getPlatformPackageName: (platform: string, arch: string) => string;
}> {
  const module = await import('../../scripts/prepare-copilot-runtime.js');
  return ('default' in module ? module.default : module) as {
    assertHostMatchesTarget: (platform: string, arch: string) => void;
    getPlatformPackageName: (platform: string, arch: string) => string;
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
});
