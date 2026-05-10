import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

import * as fs from 'fs';
import { ConfigService } from './ConfigService';

const DEFAULT_MARKETPLACES = [
  {
    id: 'github:ianphil/genesis-minds',
    label: 'Public Genesis Minds',
    url: 'https://github.com/ianphil/genesis-minds',
    owner: 'ianphil',
    repo: 'genesis-minds',
    ref: 'master',
    plugin: 'genesis-minds',
    enabled: true,
    isDefault: true,
  },
];

const mockReadFileSync = vi.mocked(fs.readFileSync);
const mockWriteFileSync = vi.mocked(fs.writeFileSync);
const mockMkdirSync = vi.mocked(fs.mkdirSync);

describe('ConfigService (v1→v2 migration)', () => {
  let svc: ConfigService;
  beforeEach(() => {
    svc = new ConfigService();
    vi.clearAllMocks();
  });

  it('migrates v1 config to v2 when file exists', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ mindPath: 'C:\\test\\mind', theme: 'light' }));
    const config = svc.load();
    expect(config.version).toBe(2);
    expect(config.minds).toHaveLength(1);
    expect(config.minds[0].path).toBe('C:\\test\\mind');
    expect(config.activeLogin).toBeNull();
    expect(config.theme).toBe('light');
  });

  it('returns default v2 config when file is missing', () => {
    mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    const config = svc.load();
    expect(config).toEqual({
      version: 2,
      minds: [],
      activeMindId: null,
      activeLogin: null,
      theme: 'dark',
      marketplaceRegistries: DEFAULT_MARKETPLACES,
    });
  });

  it('returns default v2 config for invalid JSON', () => {
    mockReadFileSync.mockReturnValue('not json');
    const config = svc.load();
    expect(config).toEqual({
      version: 2,
      minds: [],
      activeMindId: null,
      activeLogin: null,
      theme: 'dark',
      marketplaceRegistries: DEFAULT_MARKETPLACES,
    });
  });

  it('creates directory and writes v2 config', () => {
    svc.save({ version: 2, minds: [{ id: 'test-a1b2', path: 'C:\\test' }], activeMindId: 'test-a1b2', activeLogin: 'alice', theme: 'dark' });
    expect(mockMkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('config.json'),
      expect.stringContaining('"version": 2'),
    );
  });
});
