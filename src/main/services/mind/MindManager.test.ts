import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MindManager } from './MindManager';
import type { CopilotClientFactory } from '../sdk/CopilotClientFactory';
import type { IdentityLoader } from '../chat/IdentityLoader';
import type { ExtensionLoader } from '../extensions/ExtensionLoader';
import type { ConfigService } from '../config/ConfigService';
import type { ViewDiscovery } from '../lens/ViewDiscovery';

// --- Mocks ---

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(() => []),
  readFileSync: vi.fn(),
}));

import * as fs from 'fs';

const mockStart = vi.fn();
const mockStop = vi.fn();
const mockCreateSession = vi.fn(() => ({
  send: vi.fn(),
  sendAndWait: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
}));

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

const mockExtensionLoader = {
  registerAdapter: vi.fn(),
  discoverExtensions: vi.fn(() => []),
  loadTools: vi.fn(async () => ({ tools: [], loaded: [] })),
  cleanupExtensions: vi.fn(),
};

const mockConfigService = {
  load: vi.fn(() => ({ version: 2 as const, minds: [], activeMindId: null, theme: 'dark' as const })),
  save: vi.fn(),
};

const mockViewDiscovery = {
  scan: vi.fn(async () => []),
  getViews: vi.fn(() => []),
  startWatching: vi.fn(),
  stopWatching: vi.fn(),
  removeMind: vi.fn(),
  setRefreshHandler: vi.fn(),
};

describe('MindManager', () => {
  let manager: MindManager;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('# TestAgent\nSome content');
    manager = new MindManager(
      mockClientFactory as unknown as CopilotClientFactory,
      mockIdentityLoader as unknown as IdentityLoader,
      mockExtensionLoader as unknown as ExtensionLoader,
      mockConfigService as unknown as ConfigService,
      mockViewDiscovery as unknown as ViewDiscovery,
    );
  });

  describe('loadMind', () => {
    it('loads a mind from a valid directory', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      expect(mind.mindPath).toBe('/tmp/agents/q');
      expect(mind.identity.name).toBe('q');
      expect(mind.status).toBe('ready');
      expect(mockClientFactory.createClient).toHaveBeenCalledWith('/tmp/agents/q');
      expect(mockExtensionLoader.loadTools).toHaveBeenCalledWith('/tmp/agents/q');
      expect(mockConfigService.save).toHaveBeenCalled();
    });

    it('generates a stable mind ID from folder name', async () => {
      const mind = await manager.loadMind('/tmp/agents/fox');
      expect(mind.mindId).toMatch(/^fox-[a-f0-9]{4}$/);
    });

    it('throws on invalid directory (no SOUL.md or .github)', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      await expect(manager.loadMind('/tmp/invalid')).rejects.toThrow();
    });

    it('deduplicates — same path loaded twice returns existing mind', async () => {
      const mind1 = await manager.loadMind('/tmp/agents/q');
      const mind2 = await manager.loadMind('/tmp/agents/q');
      expect(mind1.mindId).toBe(mind2.mindId);
      expect(mockClientFactory.createClient).toHaveBeenCalledTimes(1);
    });

    it('emits mind:loaded event', async () => {
      const listener = vi.fn();
      manager.on('mind:loaded', listener);
      await manager.loadMind('/tmp/agents/q');
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ mindPath: '/tmp/agents/q' }));
    });
  });

  describe('unloadMind', () => {
    it('destroys session, client, extensions and removes from map', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      await manager.unloadMind(mind.mindId);
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
        theme: 'dark',
      });

      await manager.restoreFromConfig();
      expect(manager.listMinds()).toHaveLength(2);
    });

    it('skips invalid paths without blocking others', async () => {
      vi.mocked(fs.existsSync).mockImplementation((p: fs.PathLike) => {
        return !String(p).includes('bad');
      });

      mockConfigService.load.mockReturnValue({
        version: 2,
        minds: [
          { id: 'good-a1b2', path: '/tmp/agents/good' },
          { id: 'bad-c3d4', path: '/tmp/agents/bad' },
        ],
        activeMindId: 'good-a1b2',
        theme: 'dark',
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(vi.fn());
      await manager.restoreFromConfig();
      expect(manager.listMinds()).toHaveLength(1);
      expect(manager.listMinds()[0].identity.name).toBe('good');
      consoleSpy.mockRestore();
    });

    it('handles empty config gracefully', async () => {
      mockConfigService.load.mockReturnValue({
        version: 2, minds: [], activeMindId: null, theme: 'dark',
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
            sectionOverrides: expect.arrayContaining([
              expect.objectContaining({
                section: 'identity',
                override: { type: 'replace', content: 'Identity for /tmp/agents/q' },
              }),
            ]),
          }),
        }),
      );
    });

    it('applies toolBuilder to session tools', async () => {
      const a2aTool = { name: 'send_message' };
      const toolBuilder = vi.fn((_mindId: string, extTools: unknown[]) => [...extTools, a2aTool]);
      const mgr = new MindManager(
        mockClientFactory as unknown as CopilotClientFactory,
        mockIdentityLoader as unknown as IdentityLoader,
        mockExtensionLoader as unknown as ExtensionLoader,
        mockConfigService as unknown as ConfigService,
        mockViewDiscovery as unknown as ViewDiscovery,
        toolBuilder,
      );

      const mind = await mgr.loadMind('/tmp/agents/q');
      mockCreateSession.mockClear();
      toolBuilder.mockClear();

      await mgr.createTaskSession(mind.mindId, 'task-1');

      expect(toolBuilder).toHaveBeenCalledWith(mind.mindId, expect.any(Array));
      expect(mockCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: expect.arrayContaining([a2aTool]),
        }),
      );
    });

    it('accepts custom onUserInputRequest callback', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      const customCallback = vi.fn(async () => ({ answer: 'custom', wasFreeform: false }));
      mockCreateSession.mockClear();

      await manager.createTaskSession(mind.mindId, 'task-1', customCallback);

      const callArg = mockCreateSession.mock.calls[0][0];
      expect(callArg.onUserInputRequest).toBe(customCallback);
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

  describe('window management', () => {
    it('attachWindow associates a window with a mind', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      const mockWin = { focus: vi.fn(), close: vi.fn(), on: vi.fn() };
      manager.attachWindow(mind.mindId, mockWin);
      expect(manager.isWindowed(mind.mindId)).toBe(true);
      expect(manager.getWindow(mind.mindId)).toBe(mockWin);
    });

    it('detachWindow removes association, mind stays loaded', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      const mockWin = { focus: vi.fn(), close: vi.fn(), on: vi.fn() };
      manager.attachWindow(mind.mindId, mockWin);
      manager.detachWindow(mind.mindId);
      expect(manager.isWindowed(mind.mindId)).toBe(false);
      expect(manager.getWindow(mind.mindId)).toBeNull();
      expect(manager.getMind(mind.mindId)).toBeDefined();
    });

    it('getWindow returns null for non-windowed mind', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      expect(manager.getWindow(mind.mindId)).toBeNull();
    });

    it('listMinds includes windowed flag', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      expect(manager.listMinds()[0].windowed).toBe(false);
      manager.attachWindow(mind.mindId, { focus: vi.fn(), close: vi.fn(), on: vi.fn() });
      expect(manager.listMinds()[0].windowed).toBe(true);
    });

    it('auto-detaches on window close event', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      let closeHandler: (() => void) | null = null;
      const mockWin = {
        focus: vi.fn(),
        close: vi.fn(),
        on: vi.fn((event: string, cb: () => void) => { if (event === 'closed') closeHandler = cb; }),
      };
      manager.attachWindow(mind.mindId, mockWin);
      expect(manager.isWindowed(mind.mindId)).toBe(true);

      // Simulate window close
      if (!closeHandler) throw new Error('expected close handler');
      closeHandler();
      expect(manager.isWindowed(mind.mindId)).toBe(false);
    });

    it('emits mind:windowed and mind:unwindowed events', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      const windowed = vi.fn();
      const unwindowed = vi.fn();
      manager.on('mind:windowed', windowed);
      manager.on('mind:unwindowed', unwindowed);

      manager.attachWindow(mind.mindId, { focus: vi.fn(), close: vi.fn(), on: vi.fn() });
      expect(windowed).toHaveBeenCalledWith(mind.mindId);

      manager.detachWindow(mind.mindId);
      expect(unwindowed).toHaveBeenCalledWith(mind.mindId);
    });
  });

  describe('ToolBuilder integration', () => {
    it('doLoadMind() calls toolBuilder with mindId and extension tools', async () => {
      const toolBuilder = vi.fn((mindId: string, extTools: unknown[]) => [...extTools, { name: 'send_message' }, { name: 'list_agents' }]);
      const mgr = new MindManager(
        mockClientFactory as unknown as CopilotClientFactory,
        mockIdentityLoader as unknown as IdentityLoader,
        mockExtensionLoader as unknown as ExtensionLoader,
        mockConfigService as unknown as ConfigService,
        mockViewDiscovery as unknown as ViewDiscovery,
        toolBuilder,
      );

      const mockTool= { name: 'canvas_show' };
      mockExtensionLoader.loadTools.mockResolvedValueOnce({ tools: [mockTool], loaded: [{ tools: [mockTool] }] });

      await mgr.loadMind('/tmp/agents/q');

      expect(toolBuilder).toHaveBeenCalledTimes(1);
      expect(toolBuilder).toHaveBeenCalledWith(
        expect.stringMatching(/^q-/),
        [mockTool],
      );
    });

    it('doLoadMind() passes toolBuilder result to createSessionForMind', async () => {
      const a2aTool = { name: 'send_message' };
      const toolBuilder = vi.fn((_mindId: string, extTools: unknown[]) => [...extTools, a2aTool]);
      const mgr = new MindManager(
        mockClientFactory as unknown as CopilotClientFactory,
        mockIdentityLoader as unknown as IdentityLoader,
        mockExtensionLoader as unknown as ExtensionLoader,
        mockConfigService as unknown as ConfigService,
        mockViewDiscovery as unknown as ViewDiscovery,
        toolBuilder,
      );

      await mgr.loadMind('/tmp/agents/q');

      expect(mockCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: expect.arrayContaining([a2aTool]),
        }),
      );
    });

    it('recreateSession() calls toolBuilder to rebuild tools', async () => {
      const toolBuilder = vi.fn((_mindId: string, extTools: unknown[]) => [...extTools, { name: 'a2a' }]);
      const mgr = new MindManager(
        mockClientFactory as unknown as CopilotClientFactory,
        mockIdentityLoader as unknown as IdentityLoader,
        mockExtensionLoader as unknown as ExtensionLoader,
        mockConfigService as unknown as ConfigService,
        mockViewDiscovery as unknown as ViewDiscovery,
        toolBuilder,
      );

      const mind = await mgr.loadMind('/tmp/agents/q');
      toolBuilder.mockClear();

      await mgr.recreateSession(mind.mindId);

      expect(toolBuilder).toHaveBeenCalledTimes(1);
      expect(toolBuilder).toHaveBeenCalledWith(mind.mindId, expect.any(Array));
    });

    it('recreateSession() passes fresh tools to new session', async () => {
      const toolBuilder = vi.fn((_mindId: string, extTools: unknown[]) => [...extTools, { name: 'fresh_tool' }]);
      const mgr = new MindManager(
        mockClientFactory as unknown as CopilotClientFactory,
        mockIdentityLoader as unknown as IdentityLoader,
        mockExtensionLoader as unknown as ExtensionLoader,
        mockConfigService as unknown as ConfigService,
        mockViewDiscovery as unknown as ViewDiscovery,
        toolBuilder,
      );

      const mind = await mgr.loadMind('/tmp/agents/q');
      mockCreateSession.mockClear();

      await mgr.recreateSession(mind.mindId);

      expect(mockCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: expect.arrayContaining([{ name: 'fresh_tool' }]),
        }),
      );
    });

    it('works without toolBuilder (backwards compat)', async () => {
      await manager.loadMind('/tmp/agents/q');
      expect(mockCreateSession).toHaveBeenCalled();
    });
  });
});
