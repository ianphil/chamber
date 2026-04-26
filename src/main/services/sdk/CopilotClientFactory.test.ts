import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('fs', () => ({
  mkdirSync: vi.fn(),
}));

const { mockResolveNodeModulesDir, mockGetPlatformCopilotBinaryPath } = vi.hoisted(() => ({
  mockResolveNodeModulesDir: vi.fn(() => 'C:\\src\\chamber\\node_modules'),
  mockGetPlatformCopilotBinaryPath: vi.fn(
    () => 'C:\\src\\chamber\\node_modules\\@github\\copilot-win32-x64\\copilot.exe'
  ),
}));

vi.mock('./sdkPaths', () => ({
  resolveNodeModulesDir: mockResolveNodeModulesDir,
}));

vi.mock('./SdkBootstrap', () => ({
  getPlatformCopilotBinaryPath: mockGetPlatformCopilotBinaryPath,
}));

const mockStart = vi.fn();
const mockStop = vi.fn();

class FakeCopilotClient {
  options: Record<string, unknown>;
  start = mockStart;
  stop = mockStop;

  constructor(options: Record<string, unknown>) {
    this.options = options;
  }
}

vi.mock('./sdkImport', () => ({
  loadSdkModule: vi.fn(async () => ({ CopilotClient: FakeCopilotClient })),
}));

import { CopilotClientFactory } from './CopilotClientFactory';

describe('CopilotClientFactory', () => {
  let factory: CopilotClientFactory;

  beforeEach(() => {
    factory = new CopilotClientFactory();
    vi.clearAllMocks();
  });

  describe('createClient', () => {
    it('creates and starts a CopilotClient', async () => {
      const client = await factory.createClient('C:\\agents\\q');
      expect(mockStart).toHaveBeenCalledTimes(1);
      expect(client).toBeDefined();
      expect(client.start).toBeDefined();
    });

    it('passes mindPath as cwd so the CLI discovers .mcp.json from the mind folder', async () => {
      const client = await factory.createClient('C:\\agents\\q') as unknown as FakeCopilotClient;
      expect(client.options.cwd).toBe('C:\\agents\\q');
    });

    it('uses the native platform Copilot binary as cliPath', async () => {
      const client = await factory.createClient('C:\\agents\\q') as unknown as FakeCopilotClient;

      expect(mockResolveNodeModulesDir).toHaveBeenCalledTimes(1);
      expect(mockGetPlatformCopilotBinaryPath).toHaveBeenCalledWith('C:\\src\\chamber\\node_modules');
      expect(client.options.cliPath).toBe(
        'C:\\src\\chamber\\node_modules\\@github\\copilot-win32-x64\\copilot.exe'
      );
    });

    it('passes allow-all flags so SDK 0.3.0 server-side rules defer to onPermissionRequest', async () => {
      const client = await factory.createClient('C:\\agents\\q') as unknown as FakeCopilotClient;
      const cliArgs = client.options.cliArgs as string[];

      expect(cliArgs).toEqual(expect.arrayContaining([
        '--allow-all-tools',
        '--allow-all-paths',
        '--allow-all-urls',
      ]));
      expect(cliArgs).not.toContain(expect.stringMatching(/npm-loader\.js$/));
    });

    it('creates separate clients for different mind paths', async () => {
      const client1 = await factory.createClient('C:\\agents\\q');
      const client2 = await factory.createClient('C:\\agents\\fox');
      expect(mockStart).toHaveBeenCalledTimes(2);
      expect(client1).not.toBe(client2);
    });

    it('caches SDK module across multiple createClient calls', async () => {
      const { loadSdkModule } = await import('./sdkImport');
      await factory.createClient('C:\\agents\\q');
      await factory.createClient('C:\\agents\\fox');
      expect(loadSdkModule).toHaveBeenCalledTimes(1);
    });
  });

  describe('destroyClient', () => {
    it('stops the client without throwing', async () => {
      const client = await factory.createClient('C:\\agents\\q');
      await expect(factory.destroyClient(client)).resolves.not.toThrow();
      expect(mockStop).toHaveBeenCalledTimes(1);
    });

    it('handles stop() throwing gracefully', async () => {
      mockStop.mockRejectedValueOnce(new Error('stop failed'));
      const client = await factory.createClient('C:\\agents\\q');
      await expect(factory.destroyClient(client)).resolves.not.toThrow();
    });
  });
});
