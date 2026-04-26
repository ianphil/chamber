import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as path from 'path';

const isWindows = process.platform === 'win32';
const TEST_CWD = isWindows ? 'C:\\src\\chamber' : '/src/chamber';
const TEST_RUNTIME_MODULES = isWindows
  ? 'C:\\resources\\copilot-runtime\\node_modules'
  : '/resources/copilot-runtime/node_modules';

const {
  mockApp,
  mockExistsSync,
  mockGetRuntimeNodeModulesDir,
  mockIsRuntimeReady,
} = vi.hoisted(() => ({
  mockApp: { isPackaged: false },
  mockExistsSync: vi.fn(),
  mockGetRuntimeNodeModulesDir: vi.fn(),
  mockIsRuntimeReady: vi.fn(() => false),
}));

vi.mock('electron', () => ({
  app: mockApp,
}));

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
}));

vi.mock('./SdkBootstrap', () => ({
  getRuntimeNodeModulesDir: mockGetRuntimeNodeModulesDir,
  isRuntimeReady: mockIsRuntimeReady,
}));

import { resolveNodeModulesDir } from './sdkPaths';

describe('resolveNodeModulesDir', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApp.isPackaged = false;
    mockGetRuntimeNodeModulesDir.mockReturnValue(TEST_RUNTIME_MODULES);
    mockIsRuntimeReady.mockReturnValue(false);
    mockExistsSync.mockReturnValue(false);
    vi.spyOn(process, 'cwd').mockReturnValue(TEST_CWD);
  });

  it('prefers the project node_modules in dev mode', () => {
    const sdkPkgJson = path.join(TEST_CWD, 'node_modules', '@github', 'copilot-sdk', 'package.json');
    mockExistsSync.mockImplementation((candidate) => String(candidate) === sdkPkgJson);

    expect(resolveNodeModulesDir()).toBe(path.join(TEST_CWD, 'node_modules'));
  });

  it('throws in dev mode when the project install is missing', () => {
    expect(() => resolveNodeModulesDir()).toThrow(
      'Chamber requires the repo-local @github/copilot-sdk install in dev mode. Run: npm install'
    );
  });

  it('uses the packaged runtime when available', () => {
    mockApp.isPackaged = true;
    mockIsRuntimeReady.mockReturnValue(true);

    expect(resolveNodeModulesDir()).toBe(TEST_RUNTIME_MODULES);
  });

  it('throws in packaged mode when the runtime is missing', () => {
    mockApp.isPackaged = true;

    expect(() => resolveNodeModulesDir()).toThrow(
      'Chamber could not find its packaged Copilot runtime. Reinstall the app.'
    );
  });
});
