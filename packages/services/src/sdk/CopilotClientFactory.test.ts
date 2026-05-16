import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as path from 'node:path';

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
const mockForceStop = vi.fn();

class FakeCopilotClient {
  options: Record<string, unknown>;
  start = mockStart;
  stop = mockStop;
  forceStop = mockForceStop;

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
    vi.useRealTimers();
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
      const allowToolArgs = cliArgs.filter((arg) => arg.startsWith('--allow-tool='));
      expect(allowToolArgs).toEqual([
        '--allow-tool=shell',
        '--allow-tool=write',
      ]);
    });

    it('declares an explicit --allow-url list instead of --allow-all-urls (issue #131)', async () => {
      const client = await factory.createClient('C:\\agents\\q') as unknown as FakeCopilotClient;
      const cliArgs = client.options.cliArgs as string[];

      expect(cliArgs).not.toContain('--allow-all-urls');

      // Default first-party allow-list: github.com bare and the *.github.com
      // wildcard that covers api., raw., gist., codeload., etc. Anything
      // outside this list flows through onPermissionRequest where the
      // SDK handler currently auto-approves. B5 (#131 checklist 5) will
      // surface those denials in the chat UI.
      const allowUrlArgs = cliArgs.filter((arg) => arg.startsWith('--allow-url='));
      expect(allowUrlArgs).toEqual([
        '--allow-url=github.com',
        '--allow-url=*.github.com',
      ]);
    });

    it('keeps --allow-all-paths until a later checklist item drops it', async () => {
      const client = await factory.createClient('C:\\agents\\q') as unknown as FakeCopilotClient;
      const cliArgs = client.options.cliArgs as string[];

      expect(cliArgs).toContain('--allow-all-paths');
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
      const toolsBinDir = path.join('chamber-root', 'tools', 'bin');
      factory = new CopilotClientFactory({ toolsBinDir });
      const client = await factory.createClient('C:\\agents\\q') as unknown as FakeCopilotClient;
      const env = client.options.env as Record<string, string>;
      const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';

      expect(env[pathKey].split(path.delimiter)[0]).toBe(toolsBinDir);
    });

    it('does not duplicate the Chamber tools bin directory in the CLI PATH', async () => {
      const toolsBinDir = path.join('chamber-root', 'tools', 'bin');
      const existing = path.join('usr', 'bin');
      factory = new CopilotClientFactory({
        toolsBinDir,
        env: { Path: `${toolsBinDir}${path.delimiter}${existing}` },
      });
      const client = await factory.createClient('C:\\agents\\q') as unknown as FakeCopilotClient;
      const env = client.options.env as Record<string, string>;

      expect(env.Path).toBe(`${toolsBinDir}${path.delimiter}${existing}`);
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

    it('BVT-F01: passes BYO LLM extraEnv into the spawned client env', async () => {
      const client = await factory.createClient('C:\\agents\\q', {
        extraEnv: {
          COPILOT_PROVIDER_BASE_URL: 'https://example.com/v1',
          COPILOT_PROVIDER_TYPE: 'openai',
          COPILOT_PROVIDER_API_KEY: 'lm-studio',
          COPILOT_MODEL: 'gemma-4-e4b',
        },
      }) as unknown as FakeCopilotClient;
      const env = client.options.env as Record<string, string>;
      expect(env.COPILOT_PROVIDER_BASE_URL).toBe('https://example.com/v1');
      expect(env.COPILOT_PROVIDER_TYPE).toBe('openai');
      expect(env.COPILOT_PROVIDER_API_KEY).toBe('lm-studio');
      expect(env.COPILOT_MODEL).toBe('gemma-4-e4b');
    });

    it('BVT-F02: combines BYO extraEnv with toolsBinDir PATH munging', async () => {
      const toolsBin = path.join('chamber-root', 'tools', 'bin');
      const existing = path.join('usr', 'bin');
      factory = new CopilotClientFactory({
        toolsBinDir: toolsBin,
        env: { Path: existing, EXISTING_VAR: 'existing' },
      });
      const client = await factory.createClient('C:\\agents\\q', {
        extraEnv: { COPILOT_PROVIDER_BASE_URL: 'https://example.com/v1' },
      }) as unknown as FakeCopilotClient;
      const env = client.options.env as Record<string, string>;
      expect(env.Path).toBe(`${toolsBin}${path.delimiter}${existing}`);
      expect(env.EXISTING_VAR).toBe('existing');
      expect(env.COPILOT_PROVIDER_BASE_URL).toBe('https://example.com/v1');
    });

    it('BVT-F03: omitted or empty extraEnv does not change behaviour', async () => {
      const a = await factory.createClient('C:\\agents\\q') as unknown as FakeCopilotClient;
      const b = await factory.createClient('C:\\agents\\q', { extraEnv: {} }) as unknown as FakeCopilotClient;
      const envA = a.options.env as Record<string, string>;
      const envB = b.options.env as Record<string, string>;
      expect(envA.COPILOT_PROVIDER_BASE_URL).toBeUndefined();
      expect(envB.COPILOT_PROVIDER_BASE_URL).toBeUndefined();
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
      expect(mockForceStop).toHaveBeenCalledTimes(1);
    });

    it('force-stops the client if graceful stop hangs', async () => {
      vi.useFakeTimers();
      factory = new CopilotClientFactory({ stopTimeoutMs: 10 });
      mockStop.mockImplementationOnce(() => new Promise(() => undefined));

      const client = await factory.createClient('C:\\agents\\q');
      const destroy = factory.destroyClient(client);
      await vi.advanceTimersByTimeAsync(10);

      await expect(destroy).resolves.not.toThrow();
      expect(mockForceStop).toHaveBeenCalledTimes(1);
    });
  });

  describe('preloadSdk (#59)', () => {
    it('loads the SDK module exactly once when called repeatedly (idempotent)', async () => {
      const { loadSdkModule } = await import('./sdkImport');
      await factory.preloadSdk();
      await factory.preloadSdk();
      await factory.preloadSdk();
      expect(loadSdkModule).toHaveBeenCalledTimes(1);
    });

    it('warms the cache so a subsequent createClient does not re-load the SDK module', async () => {
      const { loadSdkModule } = await import('./sdkImport');
      await factory.preloadSdk();
      await factory.createClient('C:\\agents\\q');
      // Pre-warm + first createClient share the same cached SDK module — no
      // second import. Without preloadSdk this would still pass because
      // getSdk caches; the value-add is that the import happens during the
      // landing-screen wait instead of blocking the user-initiated load.
      expect(loadSdkModule).toHaveBeenCalledTimes(1);
    });

    it('does not start a CopilotClient subprocess (only loads the JS module)', async () => {
      await factory.preloadSdk();
      expect(mockStart).not.toHaveBeenCalled();
    });

    it('returns the same Promise to concurrent preload calls so the SDK loads once', async () => {
      const { loadSdkModule } = await import('./sdkImport');
      await Promise.all([factory.preloadSdk(), factory.preloadSdk(), factory.preloadSdk()]);
      expect(loadSdkModule).toHaveBeenCalledTimes(1);
    });
  });
});
