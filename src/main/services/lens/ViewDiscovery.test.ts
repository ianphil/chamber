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

describe('ViewDiscovery', () => {
  let discovery: ViewDiscovery;

  beforeEach(() => {
    discovery = new ViewDiscovery();
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
  });

  describe('scan', () => {
    it('returns parsed view manifests from .github/lens/', async () => {
      mockExistsSync.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        if (s.endsWith('.github\\lens')) return true;
        if (s.endsWith('my-view\\view.json')) return true;
        return false;
      });

      mockReaddirSync.mockReturnValue([
        { name: 'my-view', isDirectory: () => true },
      ] as unknown as ReturnType<typeof fs.readdirSync>);

      mockReadFileSync.mockReturnValue(JSON.stringify({
        name: 'My View', icon: 'eye', view: 'briefing', source: 'data.json',
      }));

      const views = await discovery.scan('C:\\test\\mind');
      expect(views).toHaveLength(1);
      expect(views[0].name).toBe('My View');
      expect(views[0].id).toBe('my-view');
    });

    it('stores views per-mind without clobbering others', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        { name: 'v1', isDirectory: () => true },
      ] as unknown as ReturnType<typeof fs.readdirSync>);
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'V1', icon: 'a', view: 'form', source: 'd.json' }));

      await discovery.scan('C:\\mind-a');

      mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'V2', icon: 'b', view: 'form', source: 'd.json' }));
      await discovery.scan('C:\\mind-b');

      expect(discovery.getViews('C:\\mind-a')).toHaveLength(1);
      expect(discovery.getViews('C:\\mind-b')).toHaveLength(1);
      expect(discovery.getViews('C:\\mind-a')[0].name).toBe('V1');
      expect(discovery.getViews('C:\\mind-b')[0].name).toBe('V2');
    });

    it('returns empty when no lens dir exists', async () => {
      mockExistsSync.mockReturnValue(false);
      const views = await discovery.scan('C:\\test\\mind');
      expect(views).toEqual([]);
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
      expect(views).toEqual([]);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('getViews', () => {
    it('returns empty before scan', () => {
      expect(discovery.getViews('C:\\mind')).toEqual([]);
    });

    it('returns all views when no mindPath given', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        { name: 'v', isDirectory: () => true },
      ] as unknown as ReturnType<typeof fs.readdirSync>);
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'V', icon: 'x', view: 'form', source: 'd.json' }));

      await discovery.scan('C:\\mind-a');
      await discovery.scan('C:\\mind-b');

      expect(discovery.getViews()).toHaveLength(2);
    });
  });

  describe('getViewData', () => {
    it('returns parsed data for valid view', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        { name: 'test', isDirectory: () => true },
      ] as unknown as ReturnType<typeof fs.readdirSync>);
      mockReadFileSync.mockReturnValueOnce(JSON.stringify({
        name: 'Test', icon: 'eye', view: 'briefing', source: 'data.json',
      }));

      await discovery.scan('C:\\test\\mind');

      mockReadFileSync.mockReturnValueOnce(JSON.stringify({ count: 42 }));
      const data = discovery.getViewData('test', 'C:\\test\\mind');
      expect(data).toEqual({ count: 42 });
    });

    it('returns null for unknown viewId', () => {
      expect(discovery.getViewData('nonexistent', 'C:\\mind')).toBeNull();
    });
  });

  describe('removeMind', () => {
    it('clears views and stops watching for that mind', async () => {
      const mockClose = vi.fn();
      vi.mocked(fs.watch).mockReturnValue({ close: mockClose } as unknown as fs.FSWatcher);
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([]);

      await discovery.scan('C:\\mind-a');
      discovery.startWatching('C:\\mind-a', vi.fn());
      discovery.removeMind('C:\\mind-a');

      expect(discovery.getViews('C:\\mind-a')).toEqual([]);
      expect(mockClose).toHaveBeenCalled();
    });
  });

  describe('stopWatching', () => {
    it('closes watchers for a specific mind', () => {
      const mockClose = vi.fn();
      vi.mocked(fs.watch).mockReturnValue({ close: mockClose } as unknown as fs.FSWatcher);
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([]);

      discovery.startWatching('C:\\mind', vi.fn());
      discovery.stopWatching('C:\\mind');
      expect(mockClose).toHaveBeenCalled();
    });

    it('closes all watchers when no mindPath given', () => {
      const mockClose = vi.fn();
      vi.mocked(fs.watch).mockReturnValue({ close: mockClose } as unknown as fs.FSWatcher);
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([]);

      discovery.startWatching('C:\\mind-a', vi.fn());
      discovery.startWatching('C:\\mind-b', vi.fn());
      discovery.stopWatching();
      expect(mockClose).toHaveBeenCalledTimes(2);
    });
  });
});
