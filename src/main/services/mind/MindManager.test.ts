import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MindManager } from './MindManager';
import type { MindContext } from '../../../shared/types';

// --- Mocks ---

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(() => []),
  readFileSync: vi.fn(),
}));

import * as fs from 'fs';

const mockStart = vi.fn(async () => {});
const mockStop = vi.fn(async () => {});
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
  destroyClient: vi.fn(async () => {}),
};

const mockIdentityLoader = {
  load: vi.fn((mindPath: string) => ({
    name: mindPath.split('\\').pop() ?? 'unknown',
    systemMessage: `Identity for ${mindPath}`,
  })),
};

const mockExtensionLoader = {
  registerAdapter: vi.fn(),
  discoverExtensions: vi.fn(() => []),
  loadTools: vi.fn(async () => ({ tools: [], loaded: [] })),
  cleanupExtensions: vi.fn(async () => {}),
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
      mockClientFactory as any,
      mockIdentityLoader as any,
      mockExtensionLoader as any,
      mockConfigService as any,
      mockViewDiscovery as any,
    );
  });

  describe('loadMind', () => {
    it('loads a mind from a valid directory', async () => {
      const mind = await manager.loadMind('C:\\agents\\q');
      expect(mind.mindPath).toBe('C:\\agents\\q');
      expect(mind.identity.name).toBe('q');
      expect(mind.status).toBe('ready');
      expect(mockClientFactory.createClient).toHaveBeenCalledWith('C:\\agents\\q');
      expect(mockExtensionLoader.loadTools).toHaveBeenCalledWith('C:\\agents\\q');
      expect(mockConfigService.save).toHaveBeenCalled();
    });

    it('generates a stable mind ID from folder name', async () => {
      const mind = await manager.loadMind('C:\\agents\\fox');
      expect(mind.mindId).toMatch(/^fox-[a-f0-9]{4}$/);
    });

    it('throws on invalid directory (no SOUL.md or .github)', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      await expect(manager.loadMind('C:\\invalid')).rejects.toThrow();
    });

    it('deduplicates — same path loaded twice returns existing mind', async () => {
      const mind1 = await manager.loadMind('C:\\agents\\q');
      const mind2 = await manager.loadMind('C:\\agents\\q');
      expect(mind1.mindId).toBe(mind2.mindId);
      expect(mockClientFactory.createClient).toHaveBeenCalledTimes(1);
    });

    it('emits mind:loaded event', async () => {
      const listener = vi.fn();
      manager.on('mind:loaded', listener);
      await manager.loadMind('C:\\agents\\q');
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ mindPath: 'C:\\agents\\q' }));
    });
  });

  describe('unloadMind', () => {
    it('destroys session, client, extensions and removes from map', async () => {
      const mind = await manager.loadMind('C:\\agents\\q');
      await manager.unloadMind(mind.mindId);
      expect(mockClientFactory.destroyClient).toHaveBeenCalled();
      expect(manager.getMind(mind.mindId)).toBeUndefined();
      expect(mockConfigService.save).toHaveBeenCalled();
    });

    it('emits mind:unloaded event', async () => {
      const listener = vi.fn();
      manager.on('mind:unloaded', listener);
      const mind = await manager.loadMind('C:\\agents\\q');
      await manager.unloadMind(mind.mindId);
      expect(listener).toHaveBeenCalledWith(mind.mindId);
    });

    it('is a no-op for non-existent mindId', async () => {
      await expect(manager.unloadMind('nonexistent')).resolves.not.toThrow();
    });

    it('falls back activeMindId when active mind is unloaded', async () => {
      const mind1 = await manager.loadMind('C:\\agents\\a');
      const mind2 = await manager.loadMind('C:\\agents\\b');
      manager.setActiveMind(mind1.mindId);
      await manager.unloadMind(mind1.mindId);
      // Should fall back to remaining mind or null
      const config = mockConfigService.save.mock.calls.at(-1)?.[0];
      expect(config?.activeMindId).toBe(mind2.mindId);
    });
  });

  describe('listMinds', () => {
    it('returns MindContext array (no internal details)', async () => {
      await manager.loadMind('C:\\agents\\q');
      await manager.loadMind('C:\\agents\\fox');
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
      const mind = await manager.loadMind('C:\\agents\\q');
      const internal = manager.getMind(mind.mindId);
      expect(internal).toBeDefined();
      expect(internal!.client).toBeDefined();
      expect(internal!.session).toBeDefined();
    });

    it('returns undefined for invalid ID', () => {
      expect(manager.getMind('nonexistent')).toBeUndefined();
    });
  });

  describe('recreateSession', () => {
    it('destroys old session and creates new one', async () => {
      const mind = await manager.loadMind('C:\\agents\\q');
      const oldSession = manager.getMind(mind.mindId)!.session;

      await manager.recreateSession(mind.mindId);

      const newSession = manager.getMind(mind.mindId)!.session;
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
          { id: 'q-a1b2', path: 'C:\\agents\\q' },
          { id: 'fox-c3d4', path: 'C:\\agents\\fox' },
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
          { id: 'good-a1b2', path: 'C:\\agents\\good' },
          { id: 'bad-c3d4', path: 'C:\\agents\\bad' },
        ],
        activeMindId: 'good-a1b2',
        theme: 'dark',
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
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
      await manager.loadMind('C:\\agents\\q');
      await manager.loadMind('C:\\agents\\fox');
      await manager.shutdown();
      expect(manager.listMinds()).toHaveLength(0);
      expect(mockClientFactory.destroyClient).toHaveBeenCalledTimes(2);
    });

    it('is idempotent', async () => {
      await manager.loadMind('C:\\agents\\q');
      await manager.shutdown();
      await expect(manager.shutdown()).resolves.not.toThrow();
    });
  });

  describe('event isolation', () => {
    it('creates separate sessions for different minds', async () => {
      await manager.loadMind('C:\\agents\\q');
      await manager.loadMind('C:\\agents\\fox');
      expect(mockCreateSession).toHaveBeenCalledTimes(2);
    });
  });

  describe('restoreFromConfig ID preservation', () => {
    it('uses persisted IDs instead of generating new ones', async () => {
      mockConfigService.load.mockReturnValue({
        version: 2,
        minds: [{ id: 'my-stable-id', path: 'C:\\agents\\q' }],
        activeMindId: 'my-stable-id',
        theme: 'dark',
      });

      await manager.restoreFromConfig();
      const minds = manager.listMinds();
      expect(minds).toHaveLength(1);
      expect(minds[0].mindId).toBe('my-stable-id');
    });
  });

  describe('concurrent loadMind guard', () => {
    it('returns same promise for concurrent calls with same path', async () => {
      const promise1 = manager.loadMind('C:\\agents\\q');
      const promise2 = manager.loadMind('C:\\agents\\q');
      const [mind1, mind2] = await Promise.all([promise1, promise2]);
      expect(mind1.mindId).toBe(mind2.mindId);
      expect(mockClientFactory.createClient).toHaveBeenCalledTimes(1);
    });
  });

  describe('window management', () => {
    it('attachWindow associates a window with a mind', async () => {
      const mind = await manager.loadMind('C:\\agents\\q');
      const mockWin = { focus: vi.fn(), close: vi.fn(), on: vi.fn() };
      manager.attachWindow(mind.mindId, mockWin);
      expect(manager.isWindowed(mind.mindId)).toBe(true);
      expect(manager.getWindow(mind.mindId)).toBe(mockWin);
    });

    it('detachWindow removes association, mind stays loaded', async () => {
      const mind = await manager.loadMind('C:\\agents\\q');
      const mockWin = { focus: vi.fn(), close: vi.fn(), on: vi.fn() };
      manager.attachWindow(mind.mindId, mockWin);
      manager.detachWindow(mind.mindId);
      expect(manager.isWindowed(mind.mindId)).toBe(false);
      expect(manager.getWindow(mind.mindId)).toBeNull();
      expect(manager.getMind(mind.mindId)).toBeDefined();
    });

    it('getWindow returns null for non-windowed mind', async () => {
      const mind = await manager.loadMind('C:\\agents\\q');
      expect(manager.getWindow(mind.mindId)).toBeNull();
    });

    it('listMinds includes windowed flag', async () => {
      const mind = await manager.loadMind('C:\\agents\\q');
      expect(manager.listMinds()[0].windowed).toBe(false);
      manager.attachWindow(mind.mindId, { focus: vi.fn(), close: vi.fn(), on: vi.fn() });
      expect(manager.listMinds()[0].windowed).toBe(true);
    });

    it('auto-detaches on window close event', async () => {
      const mind = await manager.loadMind('C:\\agents\\q');
      let closeHandler: (() => void) | null = null;
      const mockWin = {
        focus: vi.fn(),
        close: vi.fn(),
        on: vi.fn((event: string, cb: () => void) => { if (event === 'closed') closeHandler = cb; }),
      };
      manager.attachWindow(mind.mindId, mockWin);
      expect(manager.isWindowed(mind.mindId)).toBe(true);

      // Simulate window close
      closeHandler!();
      expect(manager.isWindowed(mind.mindId)).toBe(false);
    });

    it('emits mind:windowed and mind:unwindowed events', async () => {
      const mind = await manager.loadMind('C:\\agents\\q');
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
});
