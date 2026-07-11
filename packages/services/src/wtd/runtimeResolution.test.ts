import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { assertSupportedWtdTarget, DEFAULT_WTD_MODEL_REVISION, resolveWtdRuntime, resolveWtdRuntimeForApp } from './runtimeResolution';

function touch(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '');
}

function writeDevFixture(cwd: string, platform: string, arch: string): void {
  const runtimeRoot = path.join(cwd, 'chamber-wtd-runtime');
  touch(path.join(runtimeRoot, 'host.mjs'));
  touch(path.join(runtimeRoot, 'node_modules', '@ianphil', 'ttasks-wtd', 'dist', 'index.js'));
  touch(path.join(runtimeRoot, 'node_modules', 'onnxruntime-node', 'bin', 'napi-v6', platform, arch, 'onnxruntime_binding.node'));
}

function writePackagedFixture(resourcesPath: string, platform: string, arch: string): void {
  const runtimeRoot = path.join(resourcesPath, 'wtd-runtime');
  touch(path.join(runtimeRoot, 'host.mjs'));
  touch(path.join(runtimeRoot, 'node_modules', '@ianphil', 'ttasks-wtd', 'dist', 'index.js'));
  touch(path.join(runtimeRoot, 'node_modules', 'onnxruntime-node', 'bin', 'napi-v6', platform, arch, 'onnxruntime_binding.node'));
  touch(platform === 'win32' ? path.join(resourcesPath, 'node', 'node.exe') : path.join(resourcesPath, 'node', 'bin', 'node'));
}

describe('assertSupportedWtdTarget', () => {
  it('accepts win32-x64 and darwin-arm64', () => {
    expect(() => assertSupportedWtdTarget('win32', 'x64')).not.toThrow();
    expect(() => assertSupportedWtdTarget('darwin', 'arm64')).not.toThrow();
  });

  it('rejects darwin-x64 explicitly', () => {
    expect(() => assertSupportedWtdTarget('darwin', 'x64')).toThrow(/Unsupported WTD runtime target darwin-x64/);
  });

  it('rejects other unsupported targets (win32-arm64, linux-x64)', () => {
    expect(() => assertSupportedWtdTarget('win32', 'arm64')).toThrow(/Unsupported WTD runtime target/);
    expect(() => assertSupportedWtdTarget('linux', 'x64')).toThrow(/Unsupported WTD runtime target/);
  });
});

describe('resolveWtdRuntime', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wtd-runtime-resolution-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('resolves dev paths from <cwd>/chamber-wtd-runtime and uses the current Node binary', () => {
    writeDevFixture(tempDir, 'win32', 'x64');

    const paths = resolveWtdRuntime({ isPackaged: false, cwd: tempDir }, 'win32', 'x64');

    expect(paths.nodeBinary).toBe(process.execPath);
    expect(paths.hostPath).toBe(path.join(tempDir, 'chamber-wtd-runtime', 'host.mjs'));
    expect(paths.wtdEntry).toBe(
      path.join(tempDir, 'chamber-wtd-runtime', 'node_modules', '@ianphil', 'ttasks-wtd', 'dist', 'index.js'),
    );
    expect(paths.onnxBinding).toBe(
      path.join(
        tempDir, 'chamber-wtd-runtime', 'node_modules', 'onnxruntime-node', 'bin', 'napi-v6', 'win32', 'x64',
        'onnxruntime_binding.node',
      ),
    );
  });

  it('resolves packaged paths from resources/wtd-runtime and the bundled node binary', () => {
    writePackagedFixture(tempDir, 'darwin', 'arm64');

    const paths = resolveWtdRuntime({ isPackaged: true, cwd: tempDir, resourcesPath: tempDir }, 'darwin', 'arm64');

    expect(paths.nodeBinary).toBe(path.join(tempDir, 'node', 'bin', 'node'));
    expect(paths.hostPath).toBe(path.join(tempDir, 'wtd-runtime', 'host.mjs'));
    expect(paths.wtdEntry).toBe(
      path.join(tempDir, 'wtd-runtime', 'node_modules', '@ianphil', 'ttasks-wtd', 'dist', 'index.js'),
    );
  });

  it('throws when packaged layout has no resourcesPath', () => {
    expect(() => resolveWtdRuntime({ isPackaged: true, cwd: tempDir }, 'win32', 'x64')).toThrow(
      /requires resourcesPath/,
    );
  });

  it('rejects an unsupported target before touching the filesystem', () => {
    expect(() => resolveWtdRuntime({ isPackaged: false, cwd: tempDir }, 'darwin', 'x64')).toThrow(
      /Unsupported WTD runtime target darwin-x64/,
    );
  });

  it('throws a descriptive error when the host script is missing', () => {
    touch(path.join(tempDir, 'chamber-wtd-runtime', 'node_modules', '@ianphil', 'ttasks-wtd', 'dist', 'index.js'));
    touch(
      path.join(
        tempDir, 'chamber-wtd-runtime', 'node_modules', 'onnxruntime-node', 'bin', 'napi-v6', 'win32', 'x64',
        'onnxruntime_binding.node',
      ),
    );

    expect(() => resolveWtdRuntime({ isPackaged: false, cwd: tempDir }, 'win32', 'x64')).toThrow(
      /WTD runtime host script/,
    );
  });

  it('throws a descriptive error when the target ONNX binding is missing', () => {
    writeDevFixture(tempDir, 'win32', 'x64');
    fs.rmSync(
      path.join(
        tempDir, 'chamber-wtd-runtime', 'node_modules', 'onnxruntime-node', 'bin', 'napi-v6', 'win32', 'x64',
        'onnxruntime_binding.node',
      ),
    );

    expect(() => resolveWtdRuntime({ isPackaged: false, cwd: tempDir }, 'win32', 'x64')).toThrow(
      /WTD ONNX runtime binary/,
    );
  });
});

describe('resolveWtdRuntimeForApp', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wtd-runtime-app-resolution-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('resolves dev runtime paths and derives the versioned cache path from userDataPath', () => {
    writeDevFixture(tempDir, 'win32', 'x64');
    const userDataPath = path.join(tempDir, 'userData');

    const resolution = resolveWtdRuntimeForApp(
      { isPackaged: false, cwd: tempDir, userDataPath },
      'win32',
      'x64',
    );

    expect(resolution.nodeBinary).toBe(process.execPath);
    expect(resolution.hostPath).toBe(path.join(tempDir, 'chamber-wtd-runtime', 'host.mjs'));
    expect(resolution.wtdEntry).toBe(
      path.join(tempDir, 'chamber-wtd-runtime', 'node_modules', '@ianphil', 'ttasks-wtd', 'dist', 'index.js'),
    );
    expect(resolution.cachePath).toBe(path.join(userDataPath, 'models', 'wtd-mixed-v1', DEFAULT_WTD_MODEL_REVISION));
  });

  it('resolves packaged runtime paths and honors an explicit model revision for the cache path', () => {
    writePackagedFixture(tempDir, 'darwin', 'arm64');
    const userDataPath = path.join(tempDir, 'userData');

    const resolution = resolveWtdRuntimeForApp(
      { isPackaged: true, cwd: tempDir, resourcesPath: tempDir, userDataPath },
      'darwin',
      'arm64',
      'v9.9.9',
    );

    expect(resolution.nodeBinary).toBe(path.join(tempDir, 'node', 'bin', 'node'));
    expect(resolution.cachePath).toBe(path.join(userDataPath, 'models', 'wtd-mixed-v1', 'v9.9.9'));
  });

  it('still throws when the packaged layout has no resourcesPath', () => {
    expect(() => resolveWtdRuntimeForApp(
      { isPackaged: true, cwd: tempDir, userDataPath: path.join(tempDir, 'userData') },
      'win32',
      'x64',
    )).toThrow(/requires resourcesPath/);
  });
});
