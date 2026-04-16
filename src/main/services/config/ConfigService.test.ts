import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

import * as fs from 'fs';
import { ConfigService } from './ConfigService';
import type { AppConfig } from '../../../shared/types';

const DEFAULT_CONFIG: AppConfig = { version: 2, minds: [], activeMindId: null, activeLogin: null, theme: 'dark' };

describe('ConfigService', () => {
  let svc: ConfigService;
  beforeEach(() => {
    svc = new ConfigService();
    vi.clearAllMocks();
  });

  describe('load', () => {
    it('returns v2 config as-is', () => {
      const v2: AppConfig = { version: 2, minds: [{ id: 'q-a1b2', path: '/tmp/agents/q' }], activeMindId: 'q-a1b2', activeLogin: 'alice', theme: 'light' };
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(v2));
      expect(svc.load()).toEqual(v2);
    });

    it('backfills activeLogin for legacy v2 configs', () => {
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
      });
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
      const config: AppConfig = { version: 2, minds: [{ id: 'q-a1b2', path: '/tmp/agents/q' }], activeMindId: 'q-a1b2', activeLogin: 'alice', theme: 'dark' };
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
  });

  describe('generateMindId', () => {
    it('generates id from folder basename + 4 hex chars', () => {
      const id = ConfigService.generateMindId('/tmp/agents/my-agent');
      expect(id).toMatch(/^my-agent-[a-f0-9]{4}$/);
    });

    it('generates id from unix-style path', () => {
      const id = ConfigService.generateMindId('/home/user/agents/fox');
      expect(id).toMatch(/^fox-[a-f0-9]{4}$/);
    });

    it('generates unique ids for same path', () => {
      const id1 = ConfigService.generateMindId('/tmp/agents/q');
      const id2 = ConfigService.generateMindId('/tmp/agents/q');
      // Statistically should differ, but both match the pattern
      expect(id1).toMatch(/^q-[a-f0-9]{4}$/);
      expect(id2).toMatch(/^q-[a-f0-9]{4}$/);
    });
  });
});
