import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn(), getAllWindows: vi.fn().mockReturnValue([]) },
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

import * as fs from 'fs';
import { loadConfig, saveConfig } from './agent';

const mockExistsSync = vi.mocked(fs.existsSync);
const mockReadFileSync = vi.mocked(fs.readFileSync);
const mockWriteFileSync = vi.mocked(fs.writeFileSync);
const mockMkdirSync = vi.mocked(fs.mkdirSync);

describe('loadConfig', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns parsed config when file exists', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ mindPath: 'C:\\test\\mind', theme: 'light' }));
    const config = loadConfig();
    expect(config).toEqual({ mindPath: 'C:\\test\\mind', theme: 'light' });
  });

  it('returns default config when file is missing', () => {
    mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    const config = loadConfig();
    expect(config).toEqual({ mindPath: null, theme: 'dark' });
  });

  it('returns default config for invalid JSON', () => {
    mockReadFileSync.mockReturnValue('not json');
    const config = loadConfig();
    expect(config).toEqual({ mindPath: null, theme: 'dark' });
  });
});

describe('saveConfig', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates directory and writes config', () => {
    saveConfig({ mindPath: 'C:\\test', theme: 'dark' });
    expect(mockMkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('config.json'),
      expect.stringContaining('"mindPath": "C:\\\\test"'),
    );
  });
});
