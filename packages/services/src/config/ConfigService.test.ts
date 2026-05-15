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

    it('preserves saved A2A relay settings', () => {
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        version: 2,
        minds: [],
        activeMindId: null,
        activeLogin: null,
        theme: 'dark',
        a2aRelayBaseUrl: ' https://switchboard.example.com ',
        a2aRelayAuthMode: 'static',
      }));

      expect(svc.load()).toEqual(expect.objectContaining({
        a2aRelayBaseUrl: 'https://switchboard.example.com',
        a2aRelayAuthMode: 'static',
      }));
    });

    it('preserves per-mind conversation history metadata without transcript text', () => {
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        version: 2,
        minds: [{
          id: 'q-a1b2',
          path: '/tmp/agents/q',
          selectedModel: 'gpt-5.4',
          activeSessionId: 'chamber-q-a1b2-conversation-1',
          conversations: [{
            sessionId: 'chamber-q-a1b2-conversation-1',
            title: 'Launch plan',
            createdAt: '2026-05-05T22:00:00.000Z',
            updatedAt: '2026-05-05T22:15:00.000Z',
            kind: 'chat',
            hasMessages: true,
            messages: [{ role: 'user', content: 'do not persist me here' }],
          }],
        }],
        activeMindId: 'q-a1b2',
        activeLogin: null,
        theme: 'dark',
      }));

      expect(svc.load().minds[0]).toEqual({
        id: 'q-a1b2',
        path: '/tmp/agents/q',
        selectedModel: 'gpt-5.4',
        activeSessionId: 'chamber-q-a1b2-conversation-1',
        conversations: [{
          sessionId: 'chamber-q-a1b2-conversation-1',
          title: 'Launch plan',
          createdAt: '2026-05-05T22:00:00.000Z',
          updatedAt: '2026-05-05T22:15:00.000Z',
          kind: 'chat',
          hasMessages: true,
        }],
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

  describe('installedTools', () => {
    it('round-trips a complete installed tool record', () => {
      const installedTool = {
        id: 'workiq',
        package: '@microsoft/workiq',
        version: 'latest',
        install: { type: 'npm-global', package: '@microsoft/workiq', version: 'latest' },
        bin: 'workiq',
        displayName: 'Microsoft Work IQ',
        description: 'Query M365 data.',
        help: 'workiq ask --help',
        agentInstructions: 'Use workiq ask.',
        source: { marketplaceId: 'github:ianphil/genesis-minds', pluginId: 'genesis-minds' },
        installedAt: '2026-05-07T21:00:00.000Z',
      };
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        version: 2,
        minds: [],
        activeMindId: null,
        activeLogin: null,
        theme: 'dark',
        installedTools: [installedTool],
      }));
      const loaded = svc.load();
      expect(loaded.installedTools).toEqual([installedTool]);
    });

    it('round-trips a GitHub release asset installed tool record', () => {
      const installedTool = {
        id: 'a365-teams',
        version: 'v0.5.0',
        bin: 'teams',
        displayName: 'A365 Teams CLI',
        description: 'Read and post Teams messages.',
        help: 'teams --help',
        agentInstructions: 'Use teams read.',
        source: { marketplaceId: 'github:agency-microsoft/genesis-minds', pluginId: 'genesis-minds' },
        installedAt: '2026-05-08T04:00:00.000Z',
        install: {
          type: 'github-release-asset',
          owner: 'agency-microsoft',
          repo: 'a365-cli',
          tag: 'v0.5.0',
          assetName: 'teams.exe',
          sha256: 'ab6d078c26648a9409137c0ae3b245d006c12c39a9222efeb0c5847b8554aa31',
          platform: 'win32',
          arch: 'x64',
          installedPath: 'C:\\Users\\ianphil\\.chamber\\tools\\bin\\teams.exe',
        },
      };
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        version: 2,
        minds: [],
        activeMindId: null,
        activeLogin: null,
        theme: 'dark',
        installedTools: [installedTool],
      }));
      const loaded = svc.load();
      expect(loaded.installedTools).toEqual([installedTool]);
    });

    it('adds install metadata to legacy npm installed tool records', () => {
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        version: 2,
        minds: [],
        activeMindId: null,
        activeLogin: null,
        theme: 'dark',
        installedTools: [
          { id: 'workiq', package: '@microsoft/workiq', version: 'latest', bin: 'workiq', displayName: 'A', description: 'a', source: { marketplaceId: 'm', pluginId: 'p' }, installedAt: '2026-01-01T00:00:00Z' },
        ],
      }));
      const loaded = svc.load();
      expect(loaded.installedTools?.[0]).toMatchObject({
        package: '@microsoft/workiq',
        install: { type: 'npm-global', package: '@microsoft/workiq', version: 'latest' },
      });
    });

    it('drops malformed tool records and deduplicates by id', () => {
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        version: 2,
        minds: [],
        activeMindId: null,
        activeLogin: null,
        theme: 'dark',
        installedTools: [
          { id: 'workiq', package: '@microsoft/workiq', version: '1', bin: 'workiq', displayName: 'A', description: 'a', source: { marketplaceId: 'm', pluginId: 'p' }, installedAt: '2026-01-01T00:00:00Z' },
          { id: 'workiq', package: 'duplicate', version: '2', bin: 'workiq', displayName: 'B', description: 'b', source: { marketplaceId: 'm', pluginId: 'p' }, installedAt: '2026-01-02T00:00:00Z' },
          { id: 'broken' },
          { not: 'a tool' },
        ],
      }));
      const loaded = svc.load();
      expect(loaded.installedTools).toHaveLength(1);
      expect(loaded.installedTools?.[0].install).toEqual({ type: 'npm-global', package: '@microsoft/workiq', version: '1' });
    });

    it('omits installedTools entirely when none are persisted', () => {
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        version: 2,
        minds: [],
        activeMindId: null,
        activeLogin: null,
        theme: 'dark',
      }));
      const loaded = svc.load();
      expect(loaded.installedTools).toBeUndefined();
    });
  });

});
