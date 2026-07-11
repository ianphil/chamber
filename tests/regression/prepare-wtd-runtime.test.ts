import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function loadPrepareWtdRuntime(): Promise<{
  SUPPORTED_TARGETS: ReadonlyArray<{ platform: string; arch: string }>;
  normalizeTarget: (platform: string, arch: string) => { platform: string; arch: string };
  pruneOnnxRuntimeBinaries: (runtimeRoot: string, target: { platform: string; arch: string }) => void;
  assertNoForeignNativeDirs: (runtimeRoot: string, target: { platform: string; arch: string }) => void;
  validateRuntimeDir: (
    runtimeRoot: string,
    target: { platform: string; arch: string },
  ) => { wtdVersion: string; onnxVersion: string };
  validateRuntimeFiles: (
    runtimeRoot: string,
    target: { platform: string; arch: string },
  ) => { wtdVersion: string; onnxVersion: string };
  readPinnedVersion: () => string;
  cleanStaleResources: () => void;
  createNestedNpmEnvironment: (baseEnv?: NodeJS.ProcessEnv) => NodeJS.ProcessEnv;
}> {
  const module = await import('../../scripts/prepare-wtd-runtime.js');
  return ('default' in module ? module.default : module) as never;
}

function seedRuntimeFixture(runtimeRoot: string, platformArchPairs: Array<[string, string]>): void {
  fs.mkdirSync(runtimeRoot, { recursive: true });
  fs.writeFileSync(path.join(runtimeRoot, 'host.mjs'), '// fixture host\n');

  const wtdDir = path.join(runtimeRoot, 'node_modules', '@ianphil', 'ttasks-wtd');
  fs.mkdirSync(path.join(wtdDir, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(wtdDir, 'package.json'), JSON.stringify({ name: '@ianphil/ttasks-wtd', version: '0.1.0' }));
  fs.writeFileSync(path.join(wtdDir, 'dist', 'index.js'), '// fixture entry\n');

  const onnxDir = path.join(runtimeRoot, 'node_modules', 'onnxruntime-node');
  fs.mkdirSync(onnxDir, { recursive: true });
  fs.writeFileSync(path.join(onnxDir, 'package.json'), JSON.stringify({ name: 'onnxruntime-node', version: '1.27.0' }));

  const napiDir = path.join(onnxDir, 'bin', 'napi-v6');
  for (const [platform, arch] of platformArchPairs) {
    const archDir = path.join(napiDir, platform, arch);
    fs.mkdirSync(archDir, { recursive: true });
    fs.writeFileSync(path.join(archDir, 'onnxruntime_binding.node'), 'native');
  }
}

describe('prepare-wtd-runtime', () => {
  it('supports exactly win32-x64 and darwin-arm64', async () => {
    const { SUPPORTED_TARGETS } = await loadPrepareWtdRuntime();
    expect(SUPPORTED_TARGETS).toEqual([
      { platform: 'win32', arch: 'x64' },
      { platform: 'darwin', arch: 'arm64' },
    ]);
  });

  it('normalizes supported targets', async () => {
    const { normalizeTarget } = await loadPrepareWtdRuntime();
    expect(normalizeTarget('win32', 'x64')).toEqual({ platform: 'win32', arch: 'x64' });
    expect(normalizeTarget('darwin', 'arm64')).toEqual({ platform: 'darwin', arch: 'arm64' });
  });

  it('rejects darwin-x64 as an unsupported target', async () => {
    const { normalizeTarget } = await loadPrepareWtdRuntime();
    expect(() => normalizeTarget('darwin', 'x64')).toThrow('Unsupported WTD runtime target darwin-x64');
  });

  it('rejects other unsupported targets (win32-arm64, linux-x64)', async () => {
    const { normalizeTarget } = await loadPrepareWtdRuntime();
    expect(() => normalizeTarget('win32', 'arm64')).toThrow('Unsupported WTD runtime target win32-arm64');
    expect(() => normalizeTarget('linux', 'x64')).toThrow('Unsupported WTD runtime target linux-x64');
  });

  it('prunes onnxruntime-node native binaries down to the packaging target', async () => {
    const { pruneOnnxRuntimeBinaries, assertNoForeignNativeDirs } = await loadPrepareWtdRuntime();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-wtd-prune-'));
    try {
      seedRuntimeFixture(root, [
        ['win32', 'x64'],
        ['win32', 'arm64'],
        ['darwin', 'arm64'],
        ['darwin', 'x64'],
        ['linux', 'x64'],
      ]);

      pruneOnnxRuntimeBinaries(root, { platform: 'win32', arch: 'x64' });

      const napiDir = path.join(root, 'node_modules', 'onnxruntime-node', 'bin', 'napi-v6');
      expect(fs.readdirSync(napiDir)).toEqual(['win32']);
      expect(fs.readdirSync(path.join(napiDir, 'win32'))).toEqual(['x64']);
      expect(() => assertNoForeignNativeDirs(root, { platform: 'win32', arch: 'x64' })).not.toThrow();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('prunes down to darwin-arm64 for a macOS target', async () => {
    const { pruneOnnxRuntimeBinaries, assertNoForeignNativeDirs } = await loadPrepareWtdRuntime();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-wtd-prune-darwin-'));
    try {
      seedRuntimeFixture(root, [
        ['win32', 'x64'],
        ['darwin', 'arm64'],
        ['darwin', 'x64'],
      ]);

      pruneOnnxRuntimeBinaries(root, { platform: 'darwin', arch: 'arm64' });

      const napiDir = path.join(root, 'node_modules', 'onnxruntime-node', 'bin', 'napi-v6');
      expect(fs.readdirSync(napiDir)).toEqual(['darwin']);
      expect(fs.readdirSync(path.join(napiDir, 'darwin'))).toEqual(['arm64']);
      expect(() => assertNoForeignNativeDirs(root, { platform: 'darwin', arch: 'arm64' })).not.toThrow();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails validation if a foreign platform directory survives pruning', async () => {
    const { assertNoForeignNativeDirs } = await loadPrepareWtdRuntime();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-wtd-foreign-'));
    try {
      // Deliberately do NOT prune — leaves darwin alongside win32.
      seedRuntimeFixture(root, [
        ['win32', 'x64'],
        ['darwin', 'arm64'],
      ]);

      expect(() => assertNoForeignNativeDirs(root, { platform: 'win32', arch: 'x64' })).toThrow(
        /foreign platform directory/,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails validation if a foreign arch directory survives pruning within the target platform', async () => {
    const { assertNoForeignNativeDirs } = await loadPrepareWtdRuntime();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-wtd-foreign-arch-'));
    try {
      seedRuntimeFixture(root, [
        ['win32', 'x64'],
        ['win32', 'arm64'],
      ]);

      expect(() => assertNoForeignNativeDirs(root, { platform: 'win32', arch: 'x64' })).toThrow(
        /did not prune to exactly win32-x64/,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('validates a correctly pruned runtime directory end to end', async () => {
    const { pruneOnnxRuntimeBinaries, validateRuntimeDir } = await loadPrepareWtdRuntime();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-wtd-validate-'));
    try {
      seedRuntimeFixture(root, [
        ['win32', 'x64'],
        ['darwin', 'arm64'],
      ]);
      pruneOnnxRuntimeBinaries(root, { platform: 'win32', arch: 'x64' });

      const result = validateRuntimeDir(root, { platform: 'win32', arch: 'x64' });
      expect(result).toEqual({ wtdVersion: '0.1.0', onnxVersion: '1.27.0' });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('accepts an unpruned development runtime when the current target is present', async () => {
    const { validateRuntimeFiles } = await loadPrepareWtdRuntime();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-wtd-dev-validate-'));
    try {
      seedRuntimeFixture(root, [
        ['win32', 'x64'],
        ['darwin', 'arm64'],
      ]);

      expect(validateRuntimeFiles(root, { platform: 'win32', arch: 'x64' })).toEqual({
        wtdVersion: '0.1.0',
        onnxVersion: '1.27.0',
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a runtime pinned to the wrong onnxruntime-node version', async () => {
    const { validateRuntimeDir } = await loadPrepareWtdRuntime();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-wtd-validate-version-'));
    try {
      seedRuntimeFixture(root, [['win32', 'x64']]);
      fs.writeFileSync(
        path.join(root, 'node_modules', 'onnxruntime-node', 'package.json'),
        JSON.stringify({ name: 'onnxruntime-node', version: '1.26.0' }),
      );

      expect(() => validateRuntimeDir(root, { platform: 'win32', arch: 'x64' })).toThrow(
        /Expected onnxruntime-node 1.27.0/,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('pins @ianphil/ttasks-wtd to the reviewed commit in the chamber-wtd-runtime manifest', () => {
    const manifest = JSON.parse(fs.readFileSync('chamber-wtd-runtime/package.json', 'utf-8')) as {
      dependencies: Record<string, string>;
    };
    expect(manifest.dependencies['@ianphil/ttasks-wtd']).toBe(
      'git+https://github.com/ianphil/ttasks-wtd.git#9dd671051935fcbb6e2aa7eb8060401d75dda68d',
    );
  });

  it('uses only public registries in the committed WTD runtime lockfile', () => {
    const lock = JSON.parse(fs.readFileSync('chamber-wtd-runtime/package-lock.json', 'utf-8')) as {
      packages: Record<string, { resolved?: string }>;
    };

    for (const entry of Object.values(lock.packages)) {
      if (!entry.resolved) continue;
      if (entry.resolved.startsWith('git+')) {
        expect(entry.resolved).toMatch(/^git\+https:\/\/github\.com\//);
        continue;
      }
      expect(entry.resolved).toMatch(/^https:\/\/registry\.npmjs\.org\//);
    }
  });

  it('cleans stale WTD resources for non-insiders (stable) packages', () => {
    const source = fs.readFileSync('scripts/prepare-wtd-runtime.js', 'utf-8');
    expect(source).toContain("process.env.CHAMBER_RELEASE_CHANNEL !== 'insiders'");
    expect(source).toContain('cleanStaleResources()');
  });

  it('stages npm installs outside the repository project config', () => {
    const source = fs.readFileSync('scripts/prepare-wtd-runtime.js', 'utf-8');
    expect(source).toContain('path.join(os.tmpdir()');
    expect(source).toContain('min-release-age');
  });

  it('removes inherited minimum-release-age from nested npm installs', async () => {
    const { createNestedNpmEnvironment } = await loadPrepareWtdRuntime();

    expect(createNestedNpmEnvironment({
      PATH: 'C:\\tools',
      npm_config_min_release_age: '7',
      NPM_CONFIG_MIN_RELEASE_AGE: '7',
    })).toEqual({
      PATH: 'C:\\tools',
      npm_config_update_notifier: 'false',
    });
  });

  it('keeps chamber-automation-runtime advisory-only: it must never depend on @ianphil/ttasks-wtd or onnxruntime-node', () => {
    // WTD is an authoring aid the agent consults before writing a script, not
    // a dependency of the generated automation script itself. If this ever
    // starts failing, something wired the WTD/onnxruntime runtime into the
    // automation execution path — the two runtimes must stay separate so
    // generated `.chamber/automation/*.ts` files remain ordinary
    // `@ianphil/ttasks-ts` programs that never load onnxruntime-node.
    const manifest = JSON.parse(fs.readFileSync('chamber-automation-runtime/package.json', 'utf-8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(manifest.dependencies ?? {}).not.toHaveProperty('@ianphil/ttasks-wtd');
    expect(manifest.dependencies ?? {}).not.toHaveProperty('onnxruntime-node');
    expect(manifest.devDependencies ?? {}).not.toHaveProperty('@ianphil/ttasks-wtd');
    expect(manifest.devDependencies ?? {}).not.toHaveProperty('onnxruntime-node');
  });
});
