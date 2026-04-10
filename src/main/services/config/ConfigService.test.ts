import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

import * as fs from 'fs';
import { ConfigService } from './ConfigService';

describe('ConfigService', () => {
  let svc: ConfigService;
  beforeEach(() => {
    svc = new ConfigService();
    vi.clearAllMocks();
  });

  describe('load', () => {
    it('returns parsed config when file exists', () => {
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({ mindPath: 'C:\\test', theme: 'light' }),
      );
      expect(svc.load()).toEqual({ mindPath: 'C:\\test', theme: 'light' });
    });

    it('returns default config when file is missing', () => {
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error('ENOENT');
      });
      expect(svc.load()).toEqual({ mindPath: null, theme: 'dark' });
    });

    it('returns default config for invalid JSON', () => {
      vi.mocked(fs.readFileSync).mockReturnValue('not json');
      expect(svc.load()).toEqual({ mindPath: null, theme: 'dark' });
    });
  });

  describe('save', () => {
    it('creates directory and writes JSON', () => {
      svc.save({ mindPath: 'C:\\test', theme: 'dark' });
      expect(vi.mocked(fs.mkdirSync)).toHaveBeenCalledWith(expect.any(String), {
        recursive: true,
      });
      expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledWith(
        expect.stringContaining('config.json'),
        expect.stringContaining('"mindPath"'),
      );
    });
  });
});
