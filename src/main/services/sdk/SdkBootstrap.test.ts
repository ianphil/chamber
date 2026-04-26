import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as path from 'path';

const { mockApp, mockExistsSync, mockReadFileSync } = vi.hoisted(() => ({
  mockApp: { isPackaged: false },
  mockExistsSync: vi.fn(),
  mockReadFileSync: vi.fn(),
}));

vi.mock('electron', () => ({ app: mockApp }));

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  statSync: vi.fn(() => ({ mode: 0o755 })),
}));

import {
  getPlatformCopilotBinaryPath,
  getPlatformCopilotPackageName,
  getRequiredRuntimeVersions,
  getRuntimeManifestDir,
  getRuntimeNodeModulesDir,
  isRuntimeReady,
  validateRuntime,
} from './SdkBootstrap';

const isWindows = process.platform === 'win32';
const TEST_CWD = isWindows ? 'C:\\src\\chamber' : '/src/chamber';
const TEST_RESOURCES = isWindows
  ? 'C:\\Program Files\\Chamber\\resources'
  : '/opt/Chamber/resources';
const TEST_RUNTIME_ROOT = isWindows ? 'C:\\runtime\\node_modules' : '/runtime/node_modules';
const platformPackageShortName = getPlatformCopilotPackageName().split('/')[1];
const cliBinaryName = isWindows ? 'copilot.exe' : 'copilot';

describe('SdkBootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApp.isPackaged = false;
    vi.spyOn(process, 'cwd').mockReturnValue(TEST_CWD);
    Object.defineProperty(process, 'resourcesPath', {
      value: TEST_RESOURCES,
      configurable: true,
    });
    mockExistsSync.mockReturnValue(false);
  });

  function mockRuntimeInstalled(
    {
      manifestDir = getRuntimeManifestDir(),
      modulesDir = getRuntimeNodeModulesDir(),
      sdkVersion = '0.3.0',
      cliVersion = '1.0.36',
      platformVersion = '1.0.36',
      includeBinary = true,
    }: {
      manifestDir?: string;
      modulesDir?: string;
      sdkVersion?: string;
      cliVersion?: string;
      platformVersion?: string;
      includeBinary?: boolean;
    } = {},
  ): void {
    const manifestPath = path.join(manifestDir, 'package.json');
    const sdkPackageJson = path.join(modulesDir, '@github', 'copilot-sdk', 'package.json');
    const cliPackageJson = path.join(modulesDir, '@github', 'copilot', 'package.json');
    const platformPackageJson = path.join(modulesDir, '@github', platformPackageShortName, 'package.json');
    const sdkEntry = path.join(modulesDir, '@github', 'copilot-sdk', 'dist', 'index.js');
    const binaryPath = path.join(modulesDir, '@github', platformPackageShortName, cliBinaryName);

    mockExistsSync.mockImplementation((candidate) => {
      const value = String(candidate);
      return value === sdkPackageJson
        || value === cliPackageJson
        || value === platformPackageJson
        || value === sdkEntry
        || (includeBinary && value === binaryPath);
    });

    mockReadFileSync.mockImplementation((candidate) => {
      switch (String(candidate)) {
        case manifestPath:
          return JSON.stringify({
            dependencies: {
              '@github/copilot-sdk': '0.3.0',
              '@github/copilot': '1.0.36',
            },
          });
        case sdkPackageJson:
          return JSON.stringify({ version: sdkVersion });
        case cliPackageJson:
          return JSON.stringify({ version: cliVersion });
        case platformPackageJson:
          return JSON.stringify({ version: platformVersion });
        default:
          throw new Error(`Unexpected file read: ${String(candidate)}`);
      }
    });
  }

  it('uses repo-local paths in dev mode', () => {
    expect(getRuntimeManifestDir()).toBe(path.join(TEST_CWD, 'chamber-copilot-runtime'));
    expect(getRuntimeNodeModulesDir()).toBe(path.join(TEST_CWD, 'node_modules'));
  });

  it('uses packaged resources paths in packaged mode', () => {
    mockApp.isPackaged = true;

    expect(getRuntimeManifestDir()).toBe(path.join(TEST_RESOURCES, 'copilot-runtime'));
    expect(getRuntimeNodeModulesDir()).toBe(
      path.join(TEST_RESOURCES, 'copilot-runtime', 'node_modules'),
    );
  });

  it('reads exact pinned runtime versions from the committed manifest', () => {
    const manifestPath = path.join(TEST_CWD, 'chamber-copilot-runtime', 'package.json');
    mockReadFileSync.mockImplementation((candidate) => {
      if (String(candidate) === manifestPath) {
        return JSON.stringify({
          dependencies: {
            '@github/copilot-sdk': '0.3.0',
            '@github/copilot': '1.0.36',
          },
        });
      }
      throw new Error(`Unexpected file read: ${String(candidate)}`);
    });

    expect(getRequiredRuntimeVersions()).toEqual({
      sdk: '0.3.0',
      cli: '1.0.36',
    });
  });

  it('builds the native Copilot binary path for the current platform', () => {
    expect(getPlatformCopilotBinaryPath(TEST_RUNTIME_ROOT)).toBe(
      path.join(TEST_RUNTIME_ROOT, '@github', platformPackageShortName, cliBinaryName),
    );
  });

  it('reports the runtime as ready when exact pinned versions are installed', () => {
    mockRuntimeInstalled();

    expect(isRuntimeReady()).toBe(true);
  });

  it('throws when the installed CLI version does not match the pinned runtime', () => {
    mockRuntimeInstalled({ cliVersion: '1.0.35' });

    expect(() => validateRuntime()).toThrow('Expected Copilot CLI 1.0.36, found 1.0.35.');
  });

  it('reports the runtime as not ready when the native binary is missing', () => {
    mockRuntimeInstalled({ includeBinary: false });

    expect(isRuntimeReady()).toBe(false);
  });
});
