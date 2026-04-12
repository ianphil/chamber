import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock electron app
vi.mock('electron', () => ({ app: { isPackaged: false, getPath: vi.fn(() => '/tmp') } }));

// Mock SDK bootstrap/discovery
vi.mock('./SdkBootstrap', () => ({
  getLocalNodeModulesDir: vi.fn(() => '/local/node_modules'),
  getBundledNodePath: vi.fn(() => null),
  getCliPathFromModules: vi.fn(() => '/global/node_modules/@github/copilot/bin/copilot'),
  isLocalInstallReady: vi.fn(() => false),
  ensureSdkInstalled: vi.fn(async () => {}),
}));
vi.mock('./SdkDiscovery', () => ({
  getGlobalNodeModules: vi.fn(() => '/global/node_modules'),
}));
vi.mock('./nodeResolver', () => ({
  findSystemNode: vi.fn(() => '/usr/bin/node'),
}));
vi.mock('fs', () => ({
  mkdirSync: vi.fn(),
}));

// Mock the dynamic SDK import
const mockStart = vi.fn(async () => {});
const mockStop = vi.fn(async () => {});

class FakeCopilotClient {
  start = mockStart;
  stop = mockStop;
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
      // SDK module loaded once, cached
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
