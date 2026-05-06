import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MindManager } from './MindManager';
import type { CopilotClientFactory } from '../sdk/CopilotClientFactory';
import type { IdentityLoader } from '../chat/IdentityLoader';
import type { ChamberToolProvider } from '../chamberTools';
import type { ConfigService } from '../config/ConfigService';
import type { ViewDiscovery } from '../lens/ViewDiscovery';
import type { AppConfig, LensViewManifest } from '@chamber/shared/types';

// --- Mocks ---

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(() => []),
  readFileSync: vi.fn(),
  realpathSync: Object.assign(vi.fn((candidate: string) => candidate), {
    native: vi.fn((candidate: string) => candidate),
  }),
}));

vi.mock('../lens/MindBootstrap', () => ({
  bootstrapMindCapabilities: vi.fn(),
}));

import * as fs from 'fs';
import { bootstrapMindCapabilities } from '../lens/MindBootstrap';

const mockStart = vi.fn();
const mockStop = vi.fn();
function createSessionStub() {
  return {
  send: vi.fn(),
  sendAndWait: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  disconnect: vi.fn(async () => undefined),
  rpc: { permissions: { setApproveAll: vi.fn(async () => ({ success: true })) } },
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const mockCreateSession = vi.fn((_config: Record<string, unknown>) => createSessionStub());

function makeMockClient() {
  return {
    start: mockStart,
    stop: mockStop,
    createSession: mockCreateSession,
  };
}

const mockClientFactory = {
  createClient: vi.fn(async () => makeMockClient()),
  destroyClient: vi.fn(),
};

const mockIdentityLoader = {
  load: vi.fn((mindPath: string) => ({
    name: mindPath.split('/').pop() ?? 'unknown',
    systemMessage: `Identity for ${mindPath}`,
  })),
};

const mockProvider = {
  getToolsForMind: vi.fn<(_: string, __: string) => unknown[]>(() => []),
  activateMind: vi.fn(async (mindId: string, mindPath: string) => {
    void mindId;
    void mindPath;
  }),
  releaseMind: vi.fn(async (mindId: string) => {
    void mindId;
  }),
};

let currentConfig: AppConfig = {
  version: 2,
  minds: [],
  activeMindId: null,
  activeLogin: null,
  theme: 'dark',
};

const mockConfigService = {
  load: vi.fn(() => currentConfig),
  save: vi.fn((config) => {
    currentConfig = config;
  }),
};

const mockViewDiscovery = {
  scan: vi.fn<(_: string) => Promise<LensViewManifest[]>>(async () => []),
  getViews: vi.fn<() => LensViewManifest[]>(() => []),
  startWatching: vi.fn<(_: string, __: () => void) => void>(),
  stopWatching: vi.fn(),
  removeMind: vi.fn(),
  setRefreshHandler: vi.fn(),
};

function lastSavedConfig(): AppConfig {
  const config = mockConfigService.save.mock.calls.at(-1)?.[0] as AppConfig | undefined;
  if (!config) throw new Error('Expected config to be saved');
  return config;
}

function savedMindIds(config: AppConfig): string[] {
  return config.minds.map(record => record.id).sort();
}

describe('MindManager', () => {
  let manager: MindManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProvider.getToolsForMind.mockReset();
    mockProvider.activateMind.mockReset();
    mockProvider.releaseMind.mockReset();
    mockProvider.getToolsForMind.mockImplementation(() => []);
    mockProvider.activateMind.mockImplementation(async () => { /* noop */ });
    mockProvider.releaseMind.mockImplementation(async () => { /* noop */ });
    mockConfigService.load.mockReset();
    mockConfigService.save.mockReset();
    mockConfigService.load.mockImplementation(() => currentConfig);
    mockConfigService.save.mockImplementation((config) => {
      currentConfig = config;
    });
    currentConfig = {
      version: 2,
      minds: [],
      activeMindId: null,
      activeLogin: null,
      theme: 'dark',
    };
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('# TestAgent\nSome content');
    vi.mocked(fs.realpathSync.native).mockImplementation((candidate) => String(candidate));
    manager = new MindManager(
      mockClientFactory as unknown as CopilotClientFactory,
      mockIdentityLoader as unknown as IdentityLoader,
      mockConfigService as unknown as ConfigService,
      mockViewDiscovery as unknown as ViewDiscovery,
    );
    manager.setProviders([mockProvider as unknown as ChamberToolProvider]);
  });

  describe('loadMind', () => {
    it('loads a mind from a valid directory', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      expect(mind.mindPath).toBe('/tmp/agents/q');
      expect(mind.identity.name).toBe('q');
      expect(mind.status).toBe('ready');
      expect(mockClientFactory.createClient).toHaveBeenCalledWith('/tmp/agents/q');
      expect(mockProvider.getToolsForMind).toHaveBeenCalledWith(
        expect.stringMatching(/^q-/),
        '/tmp/agents/q',
      );
      expect(mockConfigService.save).toHaveBeenCalled();
    });

    it('injects current datetime context into background prompts', async () => {
      await manager.loadMind('/tmp/agents/q');
      const session = mockCreateSession.mock.results.at(-1)?.value;
      session.on.mockImplementation((event: string, callback: () => void) => {
        if (event === 'session.idle') setTimeout(callback, 0);
        return vi.fn();
      });
      await manager.sendBackgroundPrompt('/tmp/agents/q', 'do background work');

      const sentPrompt = session.send.mock.calls[0]?.[0]?.prompt;
      expect(sentPrompt).toEqual(expect.stringContaining('<current_datetime>'));
      expect(sentPrompt).toEqual(expect.stringContaining('<timezone>'));
      expect(sentPrompt).toEqual(expect.stringContaining('do background work'));
    });

    it('uses a persisted per-mind model when creating the session', async () => {
      currentConfig = {
        version: 2,
        minds: [{ id: 'q-a1b2', path: '/tmp/agents/q', selectedModel: 'gpt-5.4' }],
        activeMindId: 'q-a1b2',
        activeLogin: null,
        theme: 'dark',
      };

      await manager.restoreFromConfig();

      expect(mockCreateSession).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-5.4' }));
      expect(manager.listMinds()[0].selectedModel).toBe('gpt-5.4');
    });

    it('persists a per-mind model and recreates the session with it', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      mockCreateSession.mockClear();

      const updated = await manager.setMindModel(mind.mindId, 'claude-opus');

      expect(updated?.selectedModel).toBe('claude-opus');
      expect(lastSavedConfig().minds[0].selectedModel).toBe('claude-opus');
      expect(mockCreateSession).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-opus' }));
    });

    it('serializes concurrent per-mind model changes', async () => {
      const originalSession = createSessionStub();
      const firstModelSession = createSessionStub();
      const secondModelSession = createSessionStub();
      let resolveFirstModelSession: (() => void) | undefined;
      const createSession = vi.fn((config: Record<string, unknown>) => {
        if (config.model === 'model-a') {
          return new Promise((resolve) => {
            resolveFirstModelSession = () => resolve(firstModelSession);
          });
        }
        if (config.model === 'model-b') return Promise.resolve(secondModelSession);
        return Promise.resolve(originalSession);
      });
      const clientFactory = {
        createClient: vi.fn(async () => ({ start: vi.fn(), stop: vi.fn(), createSession })),
        destroyClient: vi.fn(),
      };
      const localManager = new MindManager(
        clientFactory as unknown as CopilotClientFactory,
        mockIdentityLoader as unknown as IdentityLoader,
        mockConfigService as unknown as ConfigService,
        mockViewDiscovery as unknown as ViewDiscovery,
      );

      const mind = await localManager.loadMind('/tmp/agents/q');
      createSession.mockClear();

      const firstChange = localManager.setMindModel(mind.mindId, 'model-a');
      const secondChange = localManager.setMindModel(mind.mindId, 'model-b');
      await Promise.resolve();
      await Promise.resolve();

      expect(createSession).toHaveBeenCalledTimes(1);
      expect(createSession).toHaveBeenCalledWith(expect.objectContaining({ model: 'model-a' }));

      resolveFirstModelSession?.();
      await Promise.all([firstChange, secondChange]);

      expect(createSession).toHaveBeenCalledTimes(2);
      expect(createSession).toHaveBeenLastCalledWith(expect.objectContaining({ model: 'model-b' }));
      expect(localManager.getMind(mind.mindId)?.selectedModel).toBe('model-b');
      expect(localManager.getMind(mind.mindId)?.session).toBe(secondModelSession);
      expect(originalSession.disconnect).toHaveBeenCalledTimes(1);
      expect(firstModelSession.disconnect).toHaveBeenCalledTimes(1);
    });

    it('bootstraps managed mind capabilities before creating the SDK session', async () => {
      await manager.loadMind('/tmp/agents/q');

      expect(bootstrapMindCapabilities).toHaveBeenCalledWith('/tmp/agents/q');
      expect(mockClientFactory.createClient).toHaveBeenCalledWith('/tmp/agents/q');
      expect(vi.mocked(bootstrapMindCapabilities).mock.invocationCallOrder[0])
        .toBeLessThan(mockClientFactory.createClient.mock.invocationCallOrder[0]);
    });

    it('continues loading when managed mind capability bootstrap fails', async () => {
      vi.mocked(bootstrapMindCapabilities).mockImplementationOnce(() => {
        throw new Error('skill asset missing');
      });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(vi.fn());

      const mind = await manager.loadMind('/tmp/agents/q');

      expect(mind.status).toBe('ready');
      expect(mockClientFactory.createClient).toHaveBeenCalledWith('/tmp/agents/q');
      warnSpy.mockRestore();
    });

    it('starts Lens watching and emits view changes after watcher rescans', async () => {
      const listener = vi.fn();
      const views: LensViewManifest[] = [{
        id: 'smoke-view',
        name: 'Smoke View',
        icon: 'table',
        view: 'table',
        source: 'data.json',
      }];
      mockViewDiscovery.getViews.mockReturnValue(views);
      manager.on('lens:viewsChanged', listener);

      await manager.loadMind('/tmp/agents/q');
      const onChanged = mockViewDiscovery.startWatching.mock.calls[0]?.[1];
      onChanged?.();

      expect(mockViewDiscovery.startWatching).toHaveBeenCalledWith('/tmp/agents/q', expect.any(Function));
      expect(mockViewDiscovery.getViews).toHaveBeenCalledWith('/tmp/agents/q');
      expect(listener).toHaveBeenCalledWith(views, expect.stringMatching(/^q-/));
    });

    it('generates a stable mind ID from folder name', async () => {
      const mind = await manager.loadMind('/tmp/agents/fox');
      expect(mind.mindId).toMatch(/^fox-[a-f0-9]{4}$/);
    });

    it('throws on invalid directory (no SOUL.md or .github)', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      await expect(manager.loadMind('/tmp/invalid')).rejects.toThrow();
    });

    it('resolves nested directories to the nearest mind root', async () => {
      vi.mocked(fs.existsSync).mockImplementation((candidate) => {
        const normalized = String(candidate).replace(/\\/g, '/');
        return normalized === '/tmp/agents/q/SOUL.md' || normalized === '/tmp/agents/q/.github';
      });

      const mind = await manager.loadMind('/tmp/agents/q/domains');
      const createClientCalls = (mockClientFactory.createClient as unknown as { mock: { calls: Array<[string]> } }).mock.calls;
      const lastCreateClientPath = String(
        createClientCalls[createClientCalls.length - 1]?.[0] ?? '',
      );

      expect(mind.mindPath.replace(/\\/g, '/')).toBe('/tmp/agents/q');
      expect(lastCreateClientPath.replace(/\\/g, '/')).toBe('/tmp/agents/q');
    });

    it('deduplicates — same path loaded twice returns existing mind', async () => {
      const mind1 = await manager.loadMind('/tmp/agents/q');
      const mind2 = await manager.loadMind('/tmp/agents/q');
      expect(mind1.mindId).toBe(mind2.mindId);
      expect(mockClientFactory.createClient).toHaveBeenCalledTimes(1);
    });

    it('deduplicates equivalent path spellings before creating another client', async () => {
      vi.mocked(fs.existsSync).mockImplementation((candidate) => {
        const normalized = String(candidate).replace(/\\/g, '/').toLowerCase();
        return normalized === '/tmp/agents/q/soul.md' || normalized === '/tmp/agents/q/.github';
      });

      const mind1 = await manager.loadMind('/tmp/agents/q');
      const mind2 = await manager.loadMind('/tmp/agents/Q/');

      expect(mind2.mindId).toBe(mind1.mindId);
      expect(mockClientFactory.createClient).toHaveBeenCalledTimes(1);
      expect(mockCreateSession).toHaveBeenCalledTimes(1);
      expect(mockProvider.activateMind).toHaveBeenCalledTimes(1);
    });

    it('deduplicates filesystem aliases by realpath before creating another client', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.realpathSync.native).mockImplementation((candidate) => {
        const normalized = String(candidate).replace(/\\/g, '/');
        if (normalized.endsWith('/tmp/aliases/q-link')) {
          return normalized.slice(0, -'/tmp/aliases/q-link'.length) + '/tmp/agents/q';
        }
        return normalized;
      });

      const mind1 = await manager.loadMind('/tmp/agents/q');
      const mind2 = await manager.loadMind('/tmp/aliases/q-link');

      expect(mind2.mindId).toBe(mind1.mindId);
      expect(mockClientFactory.createClient).toHaveBeenCalledTimes(1);
      expect(mockCreateSession).toHaveBeenCalledTimes(1);
    });

    it('emits mind:loaded event', async () => {
      const listener = vi.fn();
      manager.on('mind:loaded', listener);
      await manager.loadMind('/tmp/agents/q');
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ mindPath: '/tmp/agents/q' }));
    });
  });

  describe('unloadMind', () => {
    it('releases providers, destroys client, and removes from map', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      await manager.unloadMind(mind.mindId);
      expect(mockProvider.releaseMind).toHaveBeenCalledWith(mind.mindId);
      expect(mockClientFactory.destroyClient).toHaveBeenCalled();
      expect(manager.getMind(mind.mindId)).toBeUndefined();
      expect(mockConfigService.save).toHaveBeenCalled();
    });

    it('emits mind:unloaded event', async () => {
      const listener = vi.fn();
      manager.on('mind:unloaded', listener);
      const mind = await manager.loadMind('/tmp/agents/q');
      await manager.unloadMind(mind.mindId);
      expect(listener).toHaveBeenCalledWith(mind.mindId);
    });

    it('is a no-op for non-existent mindId', async () => {
      await expect(manager.unloadMind('nonexistent')).resolves.not.toThrow();
    });

    it('falls back activeMindId when active mind is unloaded', async () => {
      const mind1 = await manager.loadMind('/tmp/agents/a');
      const mind2 = await manager.loadMind('/tmp/agents/b');
      manager.setActiveMind(mind1.mindId);
      await manager.unloadMind(mind1.mindId);
      // Should fall back to remaining mind or null
      const config = mockConfigService.save.mock.calls.at(-1)?.[0];
      expect(config?.activeMindId).toBe(mind2.mindId);
    });

    it('explicit unload still prunes the unloaded mind from persisted config', async () => {
      const mind1 = await manager.loadMind('/tmp/agents/q');
      const mind2 = await manager.loadMind('/tmp/agents/fox');

      await manager.unloadMind(mind1.mindId);

      expect(savedMindIds(lastSavedConfig())).toEqual([mind2.mindId]);
    });
  });

  describe('listMinds', () => {
    it('returns MindContext array (no internal details)', async () => {
      await manager.loadMind('/tmp/agents/q');
      await manager.loadMind('/tmp/agents/fox');
      const minds = manager.listMinds();
      expect(minds).toHaveLength(2);
      // Verify no internal properties leaked
      for (const m of minds) {
        expect(m).toHaveProperty('mindId');
        expect(m).toHaveProperty('mindPath');
        expect(m).toHaveProperty('identity');
        expect(m).toHaveProperty('status');
        expect(m).not.toHaveProperty('client');
        expect(m).not.toHaveProperty('session');
        expect(m).not.toHaveProperty('extensions');
      }
    });
  });

  describe('getMind', () => {
    it('returns internal context for valid ID', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      const internal = manager.getMind(mind.mindId);
      if (!internal) throw new Error('expected internal mind context');
      expect(internal.client).toBeDefined();
      expect(internal.session).toBeDefined();
    });

    it('returns undefined for invalid ID', () => {
      expect(manager.getMind('nonexistent')).toBeUndefined();
    });
  });

  describe('recreateSession', () => {
    it('destroys old session and creates new one', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      manager.getMind(mind.mindId); // side-effect: verify it exists

      await manager.recreateSession(mind.mindId);

      const newCtx = manager.getMind(mind.mindId);
      if (!newCtx) throw new Error('expected mind context after recreate');
      const newSession = newCtx.session;
      expect(newSession).toBeDefined();
      expect(mockCreateSession).toHaveBeenCalledTimes(2);
    });

    it('throws for non-existent mind', async () => {
      await expect(manager.recreateSession('nonexistent')).rejects.toThrow();
    });
  });

  describe('restoreFromConfig', () => {
    it('loads all minds from config on startup', async () => {
      mockConfigService.load.mockReturnValue({
        version: 2,
        minds: [
          { id: 'q-a1b2', path: '/tmp/agents/q' },
          { id: 'fox-c3d4', path: '/tmp/agents/fox' },
        ],
        activeMindId: 'q-a1b2',
        activeLogin: 'alice',
        theme: 'dark',
      });

      await manager.restoreFromConfig();
      expect(manager.listMinds()).toHaveLength(2);
    });

    it('skips invalid paths without blocking others', async () => {
      vi.mocked(fs.existsSync).mockImplementation((p: fs.PathLike) => {
        const normalized = String(p).replace(/\\/g, '/');
        return normalized === '/tmp/agents/good/SOUL.md' || normalized === '/tmp/agents/good/.github';
      });

      mockConfigService.load.mockReturnValue({
        version: 2,
        minds: [
          { id: 'good-a1b2', path: '/tmp/agents/good' },
          { id: 'bad-c3d4', path: '/tmp/agents/bad' },
        ],
        activeMindId: 'good-a1b2',
        activeLogin: 'alice',
        theme: 'dark',
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(vi.fn());
      await manager.restoreFromConfig();
      expect(manager.listMinds()).toHaveLength(1);
      expect(manager.listMinds()[0].identity.name).toBe('good');
      consoleSpy.mockRestore();
    });

    it('preserves failed restore records when shutdown persists config', async () => {
      vi.mocked(fs.existsSync).mockImplementation((p: fs.PathLike) => {
        const normalized = String(p).replace(/\\/g, '/');
        return normalized === '/tmp/agents/good/SOUL.md' || normalized === '/tmp/agents/good/.github';
      });
      mockConfigService.load.mockReturnValue({
        version: 2,
        minds: [
          { id: 'good-a1b2', path: '/tmp/agents/good' },
          { id: 'bad-c3d4', path: '/tmp/agents/bad' },
        ],
        activeMindId: 'good-a1b2',
        activeLogin: 'alice',
        theme: 'dark',
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(vi.fn());
      await manager.restoreFromConfig();
      mockConfigService.save.mockClear();
      await manager.shutdown();

      expect(savedMindIds(lastSavedConfig())).toEqual(['bad-c3d4', 'good-a1b2']);
      consoleSpy.mockRestore();
    });

    it('preserves activeMindId when the active mind fails to restore', async () => {
      vi.mocked(fs.existsSync).mockImplementation((p: fs.PathLike) => {
        const normalized = String(p).replace(/\\/g, '/');
        return normalized === '/tmp/agents/good/SOUL.md' || normalized === '/tmp/agents/good/.github';
      });
      mockConfigService.load.mockReturnValue({
        version: 2,
        minds: [
          { id: 'bad-c3d4', path: '/tmp/agents/bad' },
          { id: 'good-a1b2', path: '/tmp/agents/good' },
        ],
        activeMindId: 'bad-c3d4',
        activeLogin: 'alice',
        theme: 'dark',
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(vi.fn());
      await manager.restoreFromConfig();
      expect(manager.getActiveMindId()).toBe('good-a1b2');
      mockConfigService.save.mockClear();
      await manager.shutdown();

      expect(lastSavedConfig().activeMindId).toBe('bad-c3d4');
      consoleSpy.mockRestore();
    });

    it('preserves every configured mind when all restores fail', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      mockConfigService.load.mockReturnValue({
        version: 2,
        minds: [
          { id: 'q-a1b2', path: '/tmp/agents/q' },
          { id: 'fox-c3d4', path: '/tmp/agents/fox' },
        ],
        activeMindId: 'q-a1b2',
        activeLogin: 'alice',
        theme: 'dark',
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(vi.fn());
      await manager.restoreFromConfig();
      mockConfigService.save.mockClear();
      await manager.shutdown();

      const config = lastSavedConfig();
      expect(savedMindIds(config)).toEqual(['fox-c3d4', 'q-a1b2']);
      expect(config.activeMindId).toBe('q-a1b2');
      consoleSpy.mockRestore();
    });

    it('handles empty config gracefully', async () => {
      mockConfigService.load.mockReturnValue({
        version: 2, minds: [], activeMindId: null, activeLogin: null, theme: 'dark',
      });

      await manager.restoreFromConfig();
      expect(manager.listMinds()).toHaveLength(0);
    });
  });

  describe('shutdown', () => {
    it('unloads all minds', async () => {
      await manager.loadMind('/tmp/agents/q');
      await manager.loadMind('/tmp/agents/fox');
      await manager.shutdown();
      expect(manager.listMinds()).toHaveLength(0);
      expect(mockClientFactory.destroyClient).toHaveBeenCalledTimes(2);
    });

    it('is idempotent', async () => {
      await manager.loadMind('/tmp/agents/q');
      await manager.shutdown();
      await expect(manager.shutdown()).resolves.not.toThrow();
    });
  });

  describe('event isolation', () => {
    it('creates separate sessions for different minds', async () => {
      await manager.loadMind('/tmp/agents/q');
      await manager.loadMind('/tmp/agents/fox');
      expect(mockCreateSession).toHaveBeenCalledTimes(2);
    });
  });

  describe('awaitRestore', () => {
    it('resolves after restoreFromConfig completes', async () => {
      mockConfigService.load.mockReturnValue({
        version: 2,
        minds: [{ id: 'q-a1b2', path: '/tmp/agents/q' }],
        activeMindId: 'q-a1b2',
        activeLogin: 'alice',
        theme: 'dark',
      });

      // Start restore (don't await it yet)
      const restorePromise = manager.restoreFromConfig();
      // awaitRestore should resolve once restore finishes
      await manager.awaitRestore();
      await restorePromise;
      expect(manager.listMinds()).toHaveLength(1);
    });

    it('resolves immediately when called before restoreFromConfig', async () => {
      // No restoreFromConfig called — should resolve without error
      await expect(manager.awaitRestore()).resolves.toBeUndefined();
    });

    it('can be called multiple times', async () => {
      mockConfigService.load.mockReturnValue({
        version: 2,
        minds: [{ id: 'q-a1b2', path: '/tmp/agents/q' }],
        activeMindId: 'q-a1b2',
        activeLogin: 'alice',
        theme: 'dark',
      });

      await manager.restoreFromConfig();
      await manager.awaitRestore();
      await manager.awaitRestore();
      expect(manager.listMinds()).toHaveLength(1);
    });
  });

  describe('restoreFromConfig ID preservation', () => {
    it('uses persisted IDs instead of generating new ones', async () => {
      mockConfigService.load.mockReturnValue({
        version: 2,
        minds: [{ id: 'my-stable-id', path: '/tmp/agents/q' }],
        activeMindId: 'my-stable-id',
        activeLogin: 'alice',
        theme: 'dark',
      });

      await manager.restoreFromConfig();
      const minds = manager.listMinds();
      expect(minds).toHaveLength(1);
      expect(minds[0].mindId).toBe('my-stable-id');
    });
  });

  describe('createTaskSession', () => {
    it('returns a session object', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      const session = await manager.createTaskSession(mind.mindId, 'task-1');
      expect(session).toBeDefined();
      expect(session).toHaveProperty('send');
    });

    it('uses same client as primary session (createSession called on same client)', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      mockCreateSession.mockClear();
      await manager.createTaskSession(mind.mindId, 'task-1');
      // createSession is on the same mock client — called once more for the task session
      expect(mockCreateSession).toHaveBeenCalledTimes(1);
    });

    it('throws for unknown mindId', async () => {
      await expect(manager.createTaskSession('nonexistent', 'task-1')).rejects.toThrow(
        'Mind nonexistent not found',
      );
    });

    it('calls createSession with correct identity (systemMessage matches)', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      mockCreateSession.mockClear();
      await manager.createTaskSession(mind.mindId, 'task-1');
      expect(mockCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          systemMessage: expect.objectContaining({
            mode: 'customize',
            sections: expect.objectContaining({
              identity: { action: 'replace', content: 'Identity for /tmp/agents/q' },
              tone: { action: 'remove' },
            }),
          }),
        }),
      );
    });

    it('includes provider tools in task sessions', async () => {
      const providerTool = {
        name: 'provider_tool',
        description: 'Provided tool',
        parameters: { type: 'object', properties: {} },
        handler: vi.fn(async () => null),
      };
      mockProvider.getToolsForMind.mockReturnValue([providerTool]);
      const mind = await manager.loadMind('/tmp/agents/q');
      mockCreateSession.mockClear();

      await manager.createTaskSession(mind.mindId, 'task-1');

      expect(mockCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: expect.arrayContaining([providerTool]),
        }),
      );
    });

    it('does not enable ask_user for task sessions without a user input handler', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      mockCreateSession.mockClear();

      await manager.createTaskSession(mind.mindId, 'task-1');

      const callArg = mockCreateSession.mock.calls[0]?.[0];
      expect(callArg).toBeDefined();
      expect(callArg).not.toHaveProperty('onUserInputRequest');
    });

    it('accepts custom onUserInputRequest callback', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      // New SDK UserInputHandler signature: (request: UserInputRequest, invocation) => UserInputResponse
      const customCallback = vi.fn(async () => ({
        answer: 'custom',
        wasFreeform: false,
      }));
      mockCreateSession.mockClear();

      await manager.createTaskSession(mind.mindId, 'task-1', customCallback);

      const callArg = mockCreateSession.mock.calls[0]?.[0];
      expect(callArg).toBeDefined();
      expect((callArg as { onUserInputRequest: unknown }).onUserInputRequest).toBe(customCallback);
    });
  });

  describe('concurrent loadMind guard', () => {
    it('returns same promise for concurrent calls with same path', async () => {
      const promise1 = manager.loadMind('/tmp/agents/q');
      const promise2 = manager.loadMind('/tmp/agents/q');
      const [mind1, mind2] = await Promise.all([promise1, promise2]);
      expect(mind1.mindId).toBe(mind2.mindId);
      expect(mockClientFactory.createClient).toHaveBeenCalledTimes(1);
    });
  });

  describe('provider integration', () => {
    it('activates providers after creating a mind session', async () => {
      await manager.loadMind('/tmp/agents/q');
      expect(mockProvider.activateMind).toHaveBeenCalledWith(
        expect.stringMatching(/^q-/),
        '/tmp/agents/q',
      );
      expect(mockCreateSession).toHaveBeenCalledTimes(1);
    });

    it('passes provider tools to createSessionForMind during load', async () => {
      const providerTool = {
        name: 'provider_tool',
        description: 'Provided tool',
        parameters: { type: 'object', properties: {} },
        handler: vi.fn(async () => null),
      };
      mockProvider.getToolsForMind.mockReturnValue([providerTool]);

      await manager.loadMind('/tmp/agents/q');

      expect(mockCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: expect.arrayContaining([providerTool]),
        }),
      );
    });

    it('recreateSession() rebuilds tools from providers', async () => {
      const providerTool = {
        name: 'fresh_tool',
        description: 'Fresh tool',
        parameters: { type: 'object', properties: {} },
        handler: vi.fn(async () => null),
      };
      mockProvider.getToolsForMind.mockReturnValue([providerTool]);
      const mind = await manager.loadMind('/tmp/agents/q');
      mockCreateSession.mockClear();

      await manager.recreateSession(mind.mindId);

      expect(mockProvider.getToolsForMind).toHaveBeenCalledWith(mind.mindId, '/tmp/agents/q');
      expect(mockCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: expect.arrayContaining([providerTool]),
        }),
      );
    });

    it('works without providers', async () => {
      const mgr = new MindManager(
        mockClientFactory as unknown as CopilotClientFactory,
        mockIdentityLoader as unknown as IdentityLoader,
        mockConfigService as unknown as ConfigService,
        mockViewDiscovery as unknown as ViewDiscovery,
      );

      await mgr.loadMind('/tmp/agents/q');

      expect(mockCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: [],
        }),
      );
    });
  });

  describe('reloadAllMinds', () => {
    it('unloads every loaded mind and restores them from config', async () => {
      await manager.loadMind('/tmp/agents/q');
      await manager.loadMind('/tmp/agents/fox');

      await manager.reloadAllMinds();

      expect(mockClientFactory.destroyClient).toHaveBeenCalledTimes(2);
      expect(manager.listMinds()).toHaveLength(2);
    });

    it('preserves activeMindId', async () => {
      const firstMind = await manager.loadMind('/tmp/agents/q');
      const secondMind = await manager.loadMind('/tmp/agents/fox');
      manager.setActiveMind(secondMind.mindId);

      await manager.reloadAllMinds();

      expect(manager.getActiveMindId()).toBe(secondMind.mindId);
      expect(manager.getActiveMindId()).not.toBe(firstMind.mindId);
    });

    it('creates fresh client instances after reload', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      const originalClient = manager.getMind(mind.mindId)?.client;

      await manager.reloadAllMinds();

      const reloadedClient = manager.getMind(mind.mindId)?.client;
      expect(reloadedClient).toBeDefined();
      expect(reloadedClient).not.toBe(originalClient);
    });

    it('preserves activeLogin in persisted config snapshots', async () => {
      mockConfigService.load.mockReturnValue({
        version: 2,
        minds: [],
        activeMindId: null,
        activeLogin: 'alice',
        theme: 'dark',
      });
      await manager.loadMind('/tmp/agents/q');

      await manager.reloadAllMinds();

      expect(mockConfigService.save).toHaveBeenCalledWith(expect.objectContaining({
        activeLogin: 'alice',
      }));
    });

    it('suppresses per-mind config writes during reload — only the snapshot save is written', async () => {
      await manager.loadMind('/tmp/agents/q');
      await manager.loadMind('/tmp/agents/fox');
      mockConfigService.save.mockClear();

      await manager.reloadAllMinds();

      // One snapshot save before restore, then one per re-loaded mind (from loadMind's persistConfig).
      // The two unloadMind calls should NOT produce saves thanks to the reloading guard.
      const saveCalls = mockConfigService.save.mock.calls;
      // First save is the snapshot (contains both minds)
      expect(saveCalls[0][0].minds).toHaveLength(2);
      // No save should have an empty minds array (which would be the mid-unload state)
      const emptyMindsSaves = saveCalls.filter((call: unknown[]) => (call[0] as { minds: unknown[] }).minds.length === 0);
      expect(emptyMindsSaves).toHaveLength(0);
    });

    it('does not drop failed restore records during reload', async () => {
      vi.mocked(fs.existsSync).mockImplementation((p: fs.PathLike) => {
        const normalized = String(p).replace(/\\/g, '/');
        return normalized === '/tmp/agents/good/SOUL.md' || normalized === '/tmp/agents/good/.github';
      });
      mockConfigService.load.mockReturnValue({
        version: 2,
        minds: [
          { id: 'good-a1b2', path: '/tmp/agents/good' },
          { id: 'bad-c3d4', path: '/tmp/agents/bad' },
        ],
        activeMindId: 'bad-c3d4',
        activeLogin: 'alice',
        theme: 'dark',
      });
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(vi.fn());
      await manager.restoreFromConfig();
      mockConfigService.save.mockClear();

      await manager.reloadAllMinds();

      for (const [config] of mockConfigService.save.mock.calls as Array<[AppConfig]>) {
        expect(savedMindIds(config)).toEqual(['bad-c3d4', 'good-a1b2']);
      }
      consoleSpy.mockRestore();
    });
  });
});
