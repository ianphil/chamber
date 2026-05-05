import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'node:path';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

import * as fs from 'fs';
import { ConfigService } from './ConfigService';
import type { AppConfig } from '@chamber/shared/types';

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
const DEFAULT_CONFIG: AppConfig = {
  version: 2,
  minds: [],
  activeMindId: null,
  activeLogin: null,
  theme: 'dark',
  marketplaceRegistries: DEFAULT_MARKETPLACES,
};

describe('ConfigService', () => {
  let svc: ConfigService;
  beforeEach(() => {
    svc = new ConfigService();
    vi.clearAllMocks();
  });

  describe('load', () => {
    it('returns v2 marketplace registries as-is when the default is present', () => {
      const v2: AppConfig = {
        version: 2,
        minds: [{ id: 'q-a1b2', path: '/tmp/agents/q' }],
        activeMindId: 'q-a1b2',
        activeLogin: 'alice',
        theme: 'light',
        marketplaceRegistries: [
          ...DEFAULT_MARKETPLACES,
          {
            id: 'github:contoso/genesis-minds',
            label: 'Contoso',
            url: 'https://github.com/contoso/genesis-minds',
            owner: 'contoso',
            repo: 'genesis-minds',
            ref: 'main',
            plugin: 'genesis-minds',
            enabled: true,
            isDefault: false,
          },
        ],
      };
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(v2));
      expect(svc.load()).toEqual(v2);
    });

    it('backfills activeLogin and the default public marketplace for legacy v2 configs', () => {
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        version: 2,
        minds: [{ id: 'q-a1b2', path: '/tmp/agents/q' }],
        activeMindId: 'q-a1b2',
        theme: 'light',
      }));

      expect(svc.load()).toEqual({
        version: 2,
        minds: [{ id: 'q-a1b2', path: '/tmp/agents/q' }],
        activeMindId: 'q-a1b2',
        activeLogin: null,
        theme: 'light',
        marketplaceRegistries: DEFAULT_MARKETPLACES,
      });
    });

    it('preserves a saved disabled state for the default public marketplace', () => {
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        version: 2,
        minds: [],
        activeMindId: null,
        activeLogin: null,
        theme: 'dark',
        marketplaceRegistries: [
          {
            ...DEFAULT_MARKETPLACES[0],
            enabled: false,
          },
        ],
      }));

      expect(svc.load().marketplaceRegistries).toEqual([
        {
          ...DEFAULT_MARKETPLACES[0],
          enabled: false,
        },
      ]);
    });

    it('migrates v1 config with mindPath to v2', () => {
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({ mindPath: '/tmp/agents/q', theme: 'light' }),
      );
      const result = svc.load();
      expect(result.version).toBe(2);
      expect(result.minds).toHaveLength(1);
      expect(result.minds[0].path).toBe('/tmp/agents/q');
      expect(result.minds[0].id).toMatch(/^q-[a-f0-9]{4}$/);
      expect(result.activeMindId).toBe(result.minds[0].id);
      expect(result.activeLogin).toBeNull();
      expect(result.theme).toBe('light');
    });

    it('migrates v1 config with null mindPath to empty v2', () => {
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({ mindPath: null, theme: 'dark' }),
      );
      expect(svc.load()).toEqual(DEFAULT_CONFIG);
    });

    it('returns default config when file is missing', () => {
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error('ENOENT');
      });
      expect(svc.load()).toEqual(DEFAULT_CONFIG);
    });

    it('returns default config for invalid JSON', () => {
      vi.mocked(fs.readFileSync).mockReturnValue('not json');
      expect(svc.load()).toEqual(DEFAULT_CONFIG);
    });

    it('deduplicates minds with the same path', () => {
      const v2: AppConfig = {
        version: 2,
        minds: [
          { id: 'q-a1b2', path: '/tmp/agents/q' },
          { id: 'q-c3d4', path: '/tmp/agents/q' },
        ],
        activeMindId: 'q-a1b2',
        activeLogin: 'alice',
        theme: 'dark',
        marketplaceRegistries: DEFAULT_MARKETPLACES,
      };
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(v2));
      const result = svc.load();
      expect(result.minds).toHaveLength(1);
      expect(result.minds[0].id).toBe('q-a1b2');
      expect(result.activeLogin).toBe('alice');
    });
  });

  describe('save', () => {
    it('creates directory and writes v2 JSON', () => {
      const config: AppConfig = {
        version: 2,
        minds: [{ id: 'q-a1b2', path: '/tmp/agents/q' }],
        activeMindId: 'q-a1b2',
        activeLogin: 'alice',
        theme: 'dark',
        marketplaceRegistries: DEFAULT_MARKETPLACES,
      };
      svc.save(config);
      expect(vi.mocked(fs.mkdirSync)).toHaveBeenCalledWith(expect.any(String), {
        recursive: true,
      });
      const written = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
      const parsed = JSON.parse(written);
      expect(parsed.version).toBe(2);
      expect(parsed.minds).toHaveLength(1);
      expect(parsed.activeLogin).toBe('alice');
    });

    it('writes config under an injected config directory', () => {
      const configDir = path.join('tmp', 'chamber-e2e-user-data');
      const config: AppConfig = { ...DEFAULT_CONFIG };
      new ConfigService(configDir).save(config);

      expect(vi.mocked(fs.mkdirSync)).toHaveBeenCalledWith(configDir, {
        recursive: true,
      });
      expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledWith(
        path.join(configDir, 'config.json'),
        JSON.stringify(config, null, 2),
      );
    });
  });

});
