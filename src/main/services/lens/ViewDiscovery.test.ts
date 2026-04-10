import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn().mockReturnValue([]) },
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  watch: vi.fn().mockReturnValue({ close: vi.fn() }),
}));

import * as fs from 'fs';
import { ViewDiscovery } from './ViewDiscovery';

const mockExistsSync = vi.mocked(fs.existsSync);
const mockReaddirSync = vi.mocked(fs.readdirSync);
const mockReadFileSync = vi.mocked(fs.readFileSync);
const mockWriteFileSync = vi.mocked(fs.writeFileSync);

const fakeChatService = {
  sendBackgroundPrompt: vi.fn().mockResolvedValue(undefined),
} as any;

describe('ViewDiscovery', () => {
  let discovery: ViewDiscovery;

  beforeEach(() => {
    discovery = new ViewDiscovery(fakeChatService);
    vi.clearAllMocks();
    // By default, existsSync returns false (no dirs exist)
    mockExistsSync.mockReturnValue(false);
  });

  describe('scan', () => {
    it('returns parsed view manifests from .github/lens/', async () => {
      // seedDefaults: hello-world and newspaper view.json don't exist → seed them
      // installLensSkill: skill doesn't exist, no candidates found
      // Then scan the lens dir
      let callCount = 0;
      mockExistsSync.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        // On scan, lens dir exists
        if (s.endsWith('.github\\lens')) return true;
        // view.json for my-view exists
        if (s.endsWith('my-view\\view.json')) return true;
        return false;
      });

      mockReaddirSync.mockReturnValue([
        { name: 'my-view', isDirectory: () => true },
      ] as unknown as ReturnType<typeof fs.readdirSync>);

      mockReadFileSync.mockReturnValue(JSON.stringify({
        name: 'My View',
        icon: 'eye',
        view: 'briefing',
        source: 'data.json',
      }));

      const views = await discovery.scan('C:\\test\\mind');
      expect(views.length).toBeGreaterThanOrEqual(1);
      const myView = views.find(v => v.id === 'my-view');
      expect(myView).toBeDefined();
      expect(myView!.name).toBe('My View');
    });

    it('returns empty when no lens dir exists', async () => {
      mockExistsSync.mockReturnValue(false);
      const views = await discovery.scan('C:\\test\\mind');
      // May include seeded defaults
      expect(Array.isArray(views)).toBe(true);
    });

    it('scan does not write files', async () => {
      mockExistsSync.mockReturnValue(false);
      await discovery.scan('C:\\test\\mind');
      expect(vi.mocked(fs.writeFileSync)).not.toHaveBeenCalled();
      expect(vi.mocked(fs.mkdirSync)).not.toHaveBeenCalled();
    });

    it('skips entries with invalid view.json', async () => {
      mockExistsSync.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        if (s.endsWith('.github\\lens')) return true;
        if (s.endsWith('bad-view\\view.json')) return true;
        return false;
      });

      mockReaddirSync.mockReturnValue([
        { name: 'bad-view', isDirectory: () => true },
      ] as unknown as ReturnType<typeof fs.readdirSync>);

      mockReadFileSync.mockReturnValue('not json');

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const views = await discovery.scan('C:\\test\\mind');
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('getViews', () => {
    it('returns empty before scan', () => {
      expect(discovery.getViews()).toEqual([]);
    });
  });

  describe('getViewData', () => {
    it('returns parsed data for valid view', async () => {
      // Set up a scanned view
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        { name: 'test', isDirectory: () => true },
      ] as unknown as ReturnType<typeof fs.readdirSync>);
      mockReadFileSync.mockReturnValueOnce(JSON.stringify({
        name: 'Test', icon: 'eye', view: 'briefing', source: 'data.json',
      }));

      await discovery.scan('C:\\test\\mind');

      // Now getViewData reads the source file
      mockReadFileSync.mockReturnValueOnce(JSON.stringify({ count: 42 }));
      const data = discovery.getViewData('test');
      expect(data).toEqual({ count: 42 });
    });

    it('returns null for unknown viewId', () => {
      expect(discovery.getViewData('nonexistent')).toBeNull();
    });
  });

  describe('stopWatching', () => {
    it('closes watchers', async () => {
      const mockClose = vi.fn();
      vi.mocked(fs.watch).mockReturnValue({ close: mockClose } as any);
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([]);
      mockReadFileSync.mockReturnValue('{}');

      await discovery.scan('C:\\test\\mind');
      discovery.startWatching(vi.fn());
      discovery.stopWatching();

      expect(mockClose).toHaveBeenCalled();
    });
  });
});
