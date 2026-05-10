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

    it('declares an explicit --allow-tool list instead of --allow-all-tools (issue #131)', async () => {
      const client = await factory.createClient('C:\\agents\\q') as unknown as FakeCopilotClient;
      const cliArgs = client.options.cliArgs as string[];

      expect(cliArgs).not.toContain('--allow-all-tools');

      // Explicit auto-approval list: only the side-effect kinds Chamber
      // intentionally auto-approves at the CLI layer. Read-only model
      // tools (view, ask_user, str_replace, etc.) do not fire permission
      // prompts so they need no entry. URL access is handled separately
      // by --allow-url (issue #131 checklist 3).
      expect(cliArgs).toEqual(expect.arrayContaining([
        '--allow-tool=shell',
        '--allow-tool=write',
      ]));
    });

    it('keeps --allow-all-paths and --allow-all-urls until later checklist items drop them', async () => {
      const client = await factory.createClient('C:\\agents\\q') as unknown as FakeCopilotClient;
      const cliArgs = client.options.cliArgs as string[];

      expect(cliArgs).toEqual(expect.arrayContaining([
        '--allow-all-paths',
        '--allow-all-urls',
      ]));
    });

    it('declares the mind cwd and the Chamber config root as --add-dir entries (issue #131)', async () => {
      const client = await factory.createClient('C:\\agents\\q') as unknown as FakeCopilotClient;
      const cliArgs = client.options.cliArgs as string[];

      // Per-session mind cwd. cwd already scopes today, but listing it
      // explicitly under --add-dir keeps the allowed-paths source of
      // truth in the same place as the chamber-shared dirs and prepares
      // for dropping --allow-all-paths in a follow-up.
      const addDirIndices = cliArgs
        .map((arg, i) => (arg === '--add-dir' ? i : -1))
        .filter((i) => i >= 0);
      const addDirValues = addDirIndices.map((i) => cliArgs[i + 1]);

      expect(addDirValues).toContain('C:\\agents\\q');
      // The Chamber config root (~/.chamber). Resolved via os.homedir so
      // we just check the tail; the home prefix varies by user/CI runner.
      expect(addDirValues.some((v) => v.endsWith('.chamber'))).toBe(true);
    });

    it('prepends the Chamber tools bin directory to the CLI PATH when configured', async () => {
      factory = new CopilotClientFactory({ toolsBinDir: 'C:\\Users\\ianphil\\AppData\\Roaming\\Chamber\\tools\\bin' });
      const client = await factory.createClient('C:\\agents\\q') as unknown as FakeCopilotClient;
      const env = client.options.env as Record<string, string>;
      const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';

      expect(env[pathKey].split(';')[0]).toBe('C:\\Users\\ianphil\\AppData\\Roaming\\Chamber\\tools\\bin');
    });

    it('does not duplicate the Chamber tools bin directory in the CLI PATH', async () => {
      const toolsBinDir = 'C:\\Users\\ianphil\\AppData\\Roaming\\Chamber\\tools\\bin';
      factory = new CopilotClientFactory({
        toolsBinDir,
        env: { Path: `${toolsBinDir};C:\\Windows\\System32` },
      });
      const client = await factory.createClient('C:\\agents\\q') as unknown as FakeCopilotClient;
      const env = client.options.env as Record<string, string>;

      expect(env.Path).toBe(`${toolsBinDir};C:\\Windows\\System32`);
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
