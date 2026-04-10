import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

import * as fs from 'fs';
import { ConfigService } from '../services/config';

const mockReadFileSync = vi.mocked(fs.readFileSync);
const mockWriteFileSync = vi.mocked(fs.writeFileSync);
const mockMkdirSync = vi.mocked(fs.mkdirSync);

describe('ConfigService (via agent.test migration)', () => {
  let svc: ConfigService;
  beforeEach(() => {
    svc = new ConfigService();
    vi.clearAllMocks();
  });

  it('returns parsed config when file exists', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ mindPath: 'C:\\test\\mind', theme: 'light' }));
    const config = svc.load();
    expect(config).toEqual({ mindPath: 'C:\\test\\mind', theme: 'light' });
  });

  it('returns default config when file is missing', () => {
    mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    const config = svc.load();
    expect(config).toEqual({ mindPath: null, theme: 'dark' });
  });

  it('returns default config for invalid JSON', () => {
    mockReadFileSync.mockReturnValue('not json');
    const config = svc.load();
    expect(config).toEqual({ mindPath: null, theme: 'dark' });
  });

  it('creates directory and writes config', () => {
    svc.save({ mindPath: 'C:\\test', theme: 'dark' });
    expect(mockMkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('config.json'),
      expect.stringContaining('"mindPath": "C:\\\\test"'),
    );
  });
});
