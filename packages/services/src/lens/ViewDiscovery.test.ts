import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';

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
        if (s.endsWith(path.join('.github', 'lens'))) return true;
        if (s.endsWith(path.join('my-view', 'view.json'))) return true;
        return false;
      });

      mockReaddirSync.mockReturnValue([
        { name: 'my-view', isDirectory: () => true },
      ] as unknown as ReturnType<typeof fs.readdirSync>);

      mockReadFileSync.mockReturnValue(JSON.stringify({
        name: 'My View', icon: 'eye', view: 'briefing', source: 'data.json',
      }));

      const views = await discovery.scan('/tmp/test/mind');
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

      await discovery.scan('/tmp/mind-a');

      mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'V2', icon: 'b', view: 'form', source: 'd.json' }));
      await discovery.scan('/tmp/mind-b');

      expect(discovery.getViews('/tmp/mind-a')).toHaveLength(1);
      expect(discovery.getViews('/tmp/mind-b')).toHaveLength(1);
      expect(discovery.getViews('/tmp/mind-a')[0].name).toBe('V1');
      expect(discovery.getViews('/tmp/mind-b')[0].name).toBe('V2');
    });

    it('returns empty when no lens dir exists', async () => {
      mockExistsSync.mockReturnValue(false);
      const views = await discovery.scan('/tmp/test/mind');
      expect(views).toEqual([]);
    });

    it('skips entries with invalid view.json', async () => {
      mockExistsSync.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        if (s.endsWith(path.join('.github', 'lens'))) return true;
        if (s.endsWith(path.join('bad-view', 'view.json'))) return true;
        return false;
      });

      mockReaddirSync.mockReturnValue([
        { name: 'bad-view', isDirectory: () => true },
      ] as unknown as ReturnType<typeof fs.readdirSync>);

      mockReadFileSync.mockReturnValue('not json');

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(vi.fn());
      const views = await discovery.scan('/tmp/test/mind');
      expect(views).toEqual([]);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('skips manifests with unsupported view types', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        { name: 'bad-view', isDirectory: () => true },
      ] as unknown as ReturnType<typeof fs.readdirSync>);
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'Bad', icon: 'eye', view: 'dashboard', source: 'data.json' }));

      await expect(discovery.scan('/tmp/test/mind')).resolves.toEqual([]);
    });

    it('accepts Canvas Lens manifests with html sources', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        { name: 'command-center', isDirectory: () => true },
      ] as unknown as ReturnType<typeof fs.readdirSync>);
      mockReadFileSync.mockReturnValue(JSON.stringify({
        name: 'Command Center',
        icon: 'layout',
        view: 'canvas',
        source: 'index.html',
      }));

      const views = await discovery.scan('/tmp/test/mind');

      expect(views).toEqual([
        expect.objectContaining({
          id: 'command-center',
          name: 'Command Center',
          view: 'canvas',
          source: 'index.html',
        }),
      ]);
    });

    it('skips Canvas Lens manifests with non-html sources', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        { name: 'bad-canvas', isDirectory: () => true },
      ] as unknown as ReturnType<typeof fs.readdirSync>);
      mockReadFileSync.mockReturnValue(JSON.stringify({
        name: 'Bad Canvas',
        icon: 'layout',
        view: 'canvas',
        source: 'data.json',
      }));

      await expect(discovery.scan('/tmp/test/mind')).resolves.toEqual([]);
    });

    it('skips manifests with missing source', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        { name: 'bad-view', isDirectory: () => true },
      ] as unknown as ReturnType<typeof fs.readdirSync>);
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'Bad', icon: 'eye', view: 'briefing' }));

      await expect(discovery.scan('/tmp/test/mind')).resolves.toEqual([]);
    });

    it('skips manifests with unsafe source paths', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        { name: 'absolute-view', isDirectory: () => true },
        { name: 'traversal-view', isDirectory: () => true },
      ] as unknown as ReturnType<typeof fs.readdirSync>);
      mockReadFileSync
        .mockReturnValueOnce(JSON.stringify({ name: 'Absolute', icon: 'eye', view: 'briefing', source: 'C:\\secrets\\data.json' }))
        .mockReturnValueOnce(JSON.stringify({ name: 'Traversal', icon: 'eye', view: 'briefing', source: '..\\data.json' }));

      await expect(discovery.scan('/tmp/test/mind')).resolves.toEqual([]);
    });
  });

  describe('getViews', () => {
    it('returns empty before scan', () => {
      expect(discovery.getViews('/tmp/mind')).toEqual([]);
    });

    it('returns all views when no mindPath given', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        { name: 'v', isDirectory: () => true },
      ] as unknown as ReturnType<typeof fs.readdirSync>);
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'V', icon: 'x', view: 'form', source: 'd.json' }));

      await discovery.scan('/tmp/mind-a');
      await discovery.scan('/tmp/mind-b');

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

      await discovery.scan('/tmp/test/mind');

      mockReadFileSync.mockReturnValueOnce(JSON.stringify({ count: 42 }));
      const data = discovery.getViewData('test', '/tmp/test/mind');
      expect(data).toEqual({ count: 42 });
    });

    it('returns null for unknown viewId', () => {
      expect(discovery.getViewData('nonexistent', '/tmp/mind')).toBeNull();
    });

    it('returns null when view data is not an object', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        { name: 'test', isDirectory: () => true },
      ] as unknown as ReturnType<typeof fs.readdirSync>);
      mockReadFileSync.mockReturnValueOnce(JSON.stringify({
        name: 'Test', icon: 'eye', view: 'briefing', source: 'data.json',
      }));

      await discovery.scan('/tmp/test/mind');

      mockReadFileSync.mockReturnValueOnce(JSON.stringify(['not', 'an', 'object']));
      expect(discovery.getViewData('test', '/tmp/test/mind')).toBeNull();
    });

    it('does not parse Canvas Lens html as JSON data', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        { name: 'canvas', isDirectory: () => true },
      ] as unknown as ReturnType<typeof fs.readdirSync>);
      mockReadFileSync.mockReturnValueOnce(JSON.stringify({
        name: 'Canvas',
        icon: 'layout',
        view: 'canvas',
        source: 'index.html',
      }));

      await discovery.scan('/tmp/test/mind');

      expect(discovery.getViewData('canvas', '/tmp/test/mind')).toBeNull();
    });
  });

  describe('removeMind', () => {
    it('clears views and stops watching for that mind', async () => {
      const mockClose = vi.fn();
      vi.mocked(fs.watch).mockReturnValue({ close: mockClose } as unknown as fs.FSWatcher);
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([]);

      await discovery.scan('/tmp/mind-a');
      discovery.startWatching('/tmp/mind-a', vi.fn());
      discovery.removeMind('/tmp/mind-a');

      expect(discovery.getViews('/tmp/mind-a')).toEqual([]);
      expect(mockClose).toHaveBeenCalled();
    });
  });

  describe('stopWatching', () => {
    it('closes watchers for a specific mind', () => {
      const mockClose = vi.fn();
      vi.mocked(fs.watch).mockReturnValue({ close: mockClose } as unknown as fs.FSWatcher);
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([]);

      discovery.startWatching('/tmp/mind', vi.fn());
      discovery.stopWatching('/tmp/mind');
      expect(mockClose).toHaveBeenCalled();
    });

    it('closes all watchers when no mindPath given', () => {
      const mockClose = vi.fn();
      vi.mocked(fs.watch).mockReturnValue({ close: mockClose } as unknown as fs.FSWatcher);
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([]);

      discovery.startWatching('/tmp/mind-a', vi.fn());
      discovery.startWatching('/tmp/mind-b', vi.fn());
      discovery.stopWatching();
      expect(mockClose).toHaveBeenCalledTimes(2);
    });
  });

  describe('startWatching — late lens/ creation', () => {
    it('watches .github/ when lens/ does not exist yet', () => {
      const mockClose = vi.fn();
      vi.mocked(fs.watch).mockReturnValue({ close: mockClose } as unknown as fs.FSWatcher);
      mockExistsSync.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        if (s.endsWith(path.join('.github', 'lens'))) return false;
        if (s.endsWith('.github')) return true;
        return false;
      });

      const onChanged = vi.fn();
      discovery.startWatching('/tmp/mind', onChanged);

      expect(fs.watch).toHaveBeenCalledWith(
        path.join('/tmp/mind', '.github'),
        expect.any(Function),
      );
    });

    it('transitions to lens/ watcher when lens/ appears', async () => {
      vi.useFakeTimers();
      const mockClose = vi.fn();
      let parentCallback: (event: string, filename: string) => void = () => {};
      vi.mocked(fs.watch).mockImplementation((_path: unknown, ...args: unknown[]) => {
        const cb = args.find(a => typeof a === 'function') as (event: string, filename: string) => void;
        if (cb) parentCallback = cb;
        return { close: mockClose } as unknown as fs.FSWatcher;
      });

      let lensExists = false;
      mockExistsSync.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        if (s.endsWith(path.join('.github', 'lens'))) return lensExists;
        if (s.endsWith('.github')) return true;
        return false;
      });
      mockReaddirSync.mockReturnValue([]);

      const onChanged = vi.fn();
      discovery.startWatching('/tmp/mind', onChanged);

      // Simulate lens/ directory appearing
      lensExists = true;
      parentCallback('rename', 'lens');
      await vi.advanceTimersByTimeAsync(300);

      expect(onChanged).toHaveBeenCalled();
      expect(mockClose).toHaveBeenCalled();
      vi.useRealTimers();
    });

    it('does nothing when .github/ does not exist either', () => {
      mockExistsSync.mockReturnValue(false);
      discovery.startWatching('/tmp/mind', vi.fn());
      expect(fs.watch).not.toHaveBeenCalled();
    });
  });

  describe('startWatching — lens view hot-load', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('rescans and notifies when a view.json is created under lens/', async () => {
      let lensCallback: (event: string, filename: string) => void = () => {};
      vi.mocked(fs.watch).mockImplementation((_path: unknown, ...args: unknown[]) => {
        const cb = args.find(a => typeof a === 'function') as (event: string, filename: string) => void;
        if (cb) lensCallback = cb;
        return { close: vi.fn() } as unknown as fs.FSWatcher;
      });

      let viewExists = false;
      mockExistsSync.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        if (s.endsWith(path.join('.github', 'lens'))) return true;
        if (s.endsWith(path.join('new-view', 'view.json'))) return viewExists;
        return false;
      });
      mockReaddirSync.mockImplementation(() => (
        viewExists
          ? [{ name: 'new-view', isDirectory: () => true }]
          : []
      ) as unknown as ReturnType<typeof fs.readdirSync>);
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'New View', icon: 'eye', view: 'briefing', source: 'data.json' }));

      const onChanged = vi.fn();
      await discovery.scan('/tmp/mind');
      discovery.startWatching('/tmp/mind', onChanged);

      viewExists = true;
      lensCallback('rename', path.join('new-view', 'view.json'));
      await vi.advanceTimersByTimeAsync(300);

      expect(discovery.getViews('/tmp/mind')).toEqual([
        expect.objectContaining({ id: 'new-view', name: 'New View' }),
      ]);
      expect(onChanged).toHaveBeenCalledTimes(1);
    });

    it('rescans and notifies when a view folder is deleted from lens/', async () => {
      let lensCallback: (event: string, filename: string) => void = () => {};
      vi.mocked(fs.watch).mockImplementation((_path: unknown, ...args: unknown[]) => {
        const cb = args.find(a => typeof a === 'function') as (event: string, filename: string) => void;
        if (cb) lensCallback = cb;
        return { close: vi.fn() } as unknown as fs.FSWatcher;
      });

      let viewExists = true;
      mockExistsSync.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        if (s.endsWith(path.join('.github', 'lens'))) return true;
        if (s.endsWith(path.join('old-view', 'view.json'))) return viewExists;
        return false;
      });
      mockReaddirSync.mockImplementation(() => (
        viewExists
          ? [{ name: 'old-view', isDirectory: () => true }]
          : []
      ) as unknown as ReturnType<typeof fs.readdirSync>);
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'Old View', icon: 'eye', view: 'briefing', source: 'data.json' }));

      await discovery.scan('/tmp/mind');
      expect(discovery.getViews('/tmp/mind')).toHaveLength(1);

      const onChanged = vi.fn();
      discovery.startWatching('/tmp/mind', onChanged);

      viewExists = false;
      lensCallback('rename', 'old-view');
      await vi.advanceTimersByTimeAsync(300);

      expect(discovery.getViews('/tmp/mind')).toEqual([]);
      expect(onChanged).toHaveBeenCalledTimes(1);
    });

    it('clears pending rescans when watching stops', async () => {
      let lensCallback: (event: string, filename: string) => void = () => {};
      vi.mocked(fs.watch).mockImplementation((_path: unknown, ...args: unknown[]) => {
        const cb = args.find(a => typeof a === 'function') as (event: string, filename: string) => void;
        if (cb) lensCallback = cb;
        return { close: vi.fn() } as unknown as fs.FSWatcher;
      });

      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([]);

      const onChanged = vi.fn();
      discovery.startWatching('/tmp/mind', onChanged);

      lensCallback('rename', 'new-view');
      discovery.stopWatching('/tmp/mind');
      await vi.advanceTimersByTimeAsync(300);

      expect(mockReaddirSync).not.toHaveBeenCalled();
      expect(onChanged).not.toHaveBeenCalled();
    });

    it('treats disappearing lens directories as empty during watcher rescans', async () => {
      let lensCallback: (event: string, filename: string) => void = () => {};
      vi.mocked(fs.watch).mockImplementation((_path: unknown, ...args: unknown[]) => {
        const cb = args.find(a => typeof a === 'function') as (event: string, filename: string) => void;
        if (cb) lensCallback = cb;
        return { close: vi.fn() } as unknown as fs.FSWatcher;
      });

      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockImplementation(() => {
        throw Object.assign(new Error('gone'), { code: 'ENOENT' });
      });

      const onChanged = vi.fn();
      discovery.startWatching('/tmp/mind', onChanged);

      lensCallback('rename', 'old-view');
      await vi.advanceTimersByTimeAsync(300);

      expect(discovery.getViews('/tmp/mind')).toEqual([]);
      expect(onChanged).toHaveBeenCalledTimes(1);
    });
  });
});
