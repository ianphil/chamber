import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExtensionLoader } from './ExtensionLoader';
import type { ExtensionAdapter, LoadedExtension, ExtensionTool } from './ExtensionLoader';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
}));

import * as fs from 'fs';

const mockExistsSync = vi.mocked(fs.existsSync);
const mockReaddirSync = vi.mocked(fs.readdirSync);

function fakeTool(name: string): ExtensionTool {
  return { name, description: `Tool ${name}`, handler: vi.fn().mockResolvedValue(null) };
}

function fakeAdapter(tools: ExtensionTool[], cleanup = vi.fn()): ExtensionAdapter {
  return vi.fn().mockResolvedValue({
    name: 'test-ext',
    tools,
    cleanup,
  } satisfies LoadedExtension);
}

describe('ExtensionLoader', () => {
  let loader: ExtensionLoader;

  beforeEach(() => {
    loader = new ExtensionLoader();
    vi.clearAllMocks();
  });

  describe('discoverExtensions', () => {
    it('returns extension directory names', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        { name: 'canvas', isDirectory: () => true },
        { name: 'cron', isDirectory: () => true },
        { name: 'README.md', isDirectory: () => false },
      ] as unknown as ReturnType<typeof fs.readdirSync>);

      const result = loader.discoverExtensions('C:\\test\\mind');
      expect(result).toEqual(['canvas', 'cron']);
    });

    it('returns empty array when extensions dir missing', () => {
      mockExistsSync.mockReturnValue(false);
      expect(loader.discoverExtensions('C:\\test\\mind')).toEqual([]);
    });
  });

  describe('loadTools', () => {
    it('returns tools and loaded extensions from adapters', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        { name: 'canvas', isDirectory: () => true },
      ] as unknown as ReturnType<typeof fs.readdirSync>);

      const tool = fakeTool('canvas_show');
      loader.registerAdapter('canvas', fakeAdapter([tool]));

      const { tools, loaded } = await loader.loadTools('C:\\test\\mind');
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('canvas_show');
      expect(loaded).toHaveLength(1);
    });

    it('skips extensions without matching adapter', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        { name: 'unknown-ext', isDirectory: () => true },
      ] as unknown as ReturnType<typeof fs.readdirSync>);

      const { tools } = await loader.loadTools('C:\\test\\mind');
      expect(tools).toHaveLength(0);
    });

    it('handles adapter errors gracefully', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        { name: 'bad', isDirectory: () => true },
        { name: 'good', isDirectory: () => true },
      ] as unknown as ReturnType<typeof fs.readdirSync>);

      loader.registerAdapter('bad', vi.fn().mockRejectedValue(new Error('boom')));
      loader.registerAdapter('good', fakeAdapter([fakeTool('good_tool')]));

      const { tools } = await loader.loadTools('C:\\test\\mind');
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('good_tool');
    });

    it('returns empty when no extensions directory', async () => {
      mockExistsSync.mockReturnValue(false);
      const { tools, loaded } = await loader.loadTools('C:\\test\\mind');
      expect(tools).toHaveLength(0);
      expect(loaded).toHaveLength(0);
    });

    it('does not store internal state between calls', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        { name: 'canvas', isDirectory: () => true },
      ] as unknown as ReturnType<typeof fs.readdirSync>);

      loader.registerAdapter('canvas', fakeAdapter([fakeTool('t')]));
      const result1 = await loader.loadTools('C:\\mind1');
      const result2 = await loader.loadTools('C:\\mind2');

      // Each call returns its own loaded array — no shared state
      expect(result1.loaded).not.toBe(result2.loaded);
    });
  });

  describe('cleanup', () => {
    it('calls cleanup on provided extensions', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        { name: 'canvas', isDirectory: () => true },
      ] as unknown as ReturnType<typeof fs.readdirSync>);

      const cleanupFn = vi.fn().mockResolvedValue(undefined);
      loader.registerAdapter('canvas', fakeAdapter([fakeTool('t')], cleanupFn));

      const { loaded } = await loader.loadTools('C:\\test\\mind');
      await ExtensionLoader.cleanup(loaded);

      expect(cleanupFn).toHaveBeenCalled();
    });

    it('handles cleanup errors gracefully', async () => {
      const badExt: LoadedExtension = {
        name: 'bad',
        tools: [],
        cleanup: vi.fn().mockRejectedValue(new Error('cleanup fail')),
      };
      await expect(ExtensionLoader.cleanup([badExt])).resolves.not.toThrow();
    });
  });
});
