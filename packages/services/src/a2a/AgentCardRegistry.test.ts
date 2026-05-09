import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MindContext } from '@chamber/shared/types';

// Mock fs before importing the module under test
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    readdirSync: vi.fn(() => []),
    readFileSync: vi.fn(() => ''),
  };
});

import * as fs from 'fs';
import * as path from 'path';
import { AgentCardRegistry } from './AgentCardRegistry';

function makeMindContext(overrides: Partial<MindContext> = {}): MindContext {
  return {
    mindId: 'q-123',
    mindPath: 'C:\\src\\q',
    identity: { name: 'Q', systemMessage: 'I am Q' },
    status: 'ready',
    ...overrides,
  } as MindContext;
}

describe('AgentCardRegistry', () => {
  let registry: AgentCardRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    registry = new AgentCardRegistry();
  });

  it('registers card when mind:loaded fires', () => {
    registry.register(makeMindContext());
    const card = registry.getCard('q-123');
    expect(card).not.toBeNull();
    if (!card) throw new Error('expected card');
    expect(card.name).toBe('Q');
  });

  it('AgentCard has all required A2A fields', () => {
    registry.register(makeMindContext());
    const card = registry.getCard('q-123');
    if (!card) throw new Error('expected card');

    expect(card.name).toBe('Q');
    expect(card.description).toBeTruthy();
    expect(card.version).toBeTruthy();
    expect(card.supportedInterfaces.length).toBeGreaterThan(0);
    expect(card.capabilities).toEqual(expect.objectContaining({ streaming: true }));
    expect(card.defaultInputModes).toContain('text/plain');
    expect(card.defaultOutputModes).toContain('text/plain');
    expect(Array.isArray(card.skills)).toBe(true);
    expect(card.mindId).toBe('q-123');
  });

  it('supportedInterfaces uses IN_PROCESS binding', () => {
    registry.register(makeMindContext());
    const card = registry.getCard('q-123');
    if (!card) throw new Error('expected card');
    const iface = card.supportedInterfaces[0];

    expect(iface.protocolBinding).toBe('IN_PROCESS');
    expect(iface.protocolVersion).toBe('1.0');
  });

  it('removes card when mind:unloaded fires', () => {
    registry.register(makeMindContext());
    expect(registry.getCard('q-123')).not.toBeNull();

    registry.unregister('q-123');
    expect(registry.getCard('q-123')).toBeNull();
  });

  it('getCards() returns all registered cards', () => {
    registry.register(makeMindContext({ mindId: 'a', identity: { name: 'A', systemMessage: '' } }));
    registry.register(makeMindContext({ mindId: 'b', identity: { name: 'B', systemMessage: '' } }));
    registry.register(makeMindContext({ mindId: 'c', identity: { name: 'C', systemMessage: '' } }));

    expect(registry.getCards()).toHaveLength(3);
  });

  it('getCardByName() resolves by identity name', () => {
    registry.register(makeMindContext({ mindId: 'q-123', identity: { name: 'Q', systemMessage: '' } }));
    const card = registry.getCardByName('Q');

    expect(card).not.toBeNull();
    if (!card) throw new Error('expected card');
    expect(card.mindId).toBe('q-123');
  });

  it('getCardByName() returns null for ambiguous names', () => {
    registry.register(makeMindContext({ mindId: 'q-1', identity: { name: 'Q', systemMessage: '' } }));
    registry.register(makeMindContext({ mindId: 'q-2', identity: { name: 'Q', systemMessage: '' } }));

    expect(registry.getCardByName('Q')).toBeNull();
  });

  it('discovers skills from .github/skills/ directories', () => {
    const mindPath = 'C:\\src\\q';

    vi.mocked(fs.existsSync).mockImplementation((p: fs.PathLike) => {
      const s = String(p);
      if (s.includes(path.join('.github', 'skills'))) return true;
      if (s.endsWith(path.join('commit', 'SKILL.md'))) return true;
      if (s.endsWith(path.join('teams', 'SKILL.md'))) return true;
      return false;
    });

    vi.mocked(fs.readdirSync).mockImplementation(((p: string) => {
      if (String(p).includes(path.join('.github', 'skills'))) {
        return [
          { name: 'commit', isDirectory: () => true },
          { name: 'teams', isDirectory: () => true },
        ] as unknown as fs.Dirent[];
      }
      return [];
    }) as unknown as typeof fs.readdirSync);

    vi.mocked(fs.readFileSync).mockImplementation(((p: string) => {
      if (String(p).endsWith(path.join('commit', 'SKILL.md'))) return '# Commit\nCommits changes to git.';
      if (String(p).endsWith(path.join('teams', 'SKILL.md'))) return '# Teams\nSend messages via Teams.';
      return '';
    }) as typeof fs.readFileSync);

    registry.register(makeMindContext({ mindPath }));
    const card = registry.getCard('q-123');
    if (!card) throw new Error('expected card');

    expect(card.skills).toHaveLength(2);

    const commit = card.skills.find((s) => s.id === 'commit');
    if (!commit) throw new Error('expected commit skill');
    expect(commit.name).toBe('Commit');
    expect(commit.description).toBe('Commits changes to git.');
    expect(commit.tags).toContain('commit');

    const teams = card.skills.find((s) => s.id === 'teams');
    if (!teams) throw new Error('expected teams skill');
    expect(teams.name).toBe('Teams');
    expect(teams.description).toBe('Send messages via Teams.');
    expect(teams.tags).toContain('teams');
  });

  describe('loadExtensionCards', () => {
    const VALID_CARD = {
      name: 'chamber-copilot',
      description: 'Drives a child Copilot CLI process from another agent\'s session.',
      version: '0.1.0',
      supportedInterfaces: [
        { url: 'extension://chamber-copilot', protocolBinding: 'COPILOT_EXTENSION', protocolVersion: '1.0' },
      ],
      capabilities: { streaming: true },
      defaultInputModes: ['text/plain'],
      defaultOutputModes: ['text/plain'],
      skills: [
        { id: 'cli-control', name: 'Drive a Copilot CLI', description: '...', tags: ['cli', 'process'] },
      ],
    };

    function stubExtensionsDir(extensionsRoot: string, entries: { dir: string; cardJson?: string }[]) {
      vi.mocked(fs.existsSync).mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        if (s === extensionsRoot) return true;
        for (const entry of entries) {
          if (entry.cardJson === undefined) continue;
          if (s === path.join(extensionsRoot, entry.dir, 'agent-card.json')) return true;
        }
        return false;
      });
      vi.mocked(fs.readdirSync).mockImplementation(((p: string, opts?: { withFileTypes?: boolean }) => {
        if (String(p) === extensionsRoot && opts?.withFileTypes) {
          return entries.map((e) => ({ name: e.dir, isDirectory: () => true })) as unknown as fs.Dirent[];
        }
        return [];
      }) as unknown as typeof fs.readdirSync);
      vi.mocked(fs.readFileSync).mockImplementation(((p: string) => {
        for (const entry of entries) {
          if (entry.cardJson !== undefined && String(p) === path.join(extensionsRoot, entry.dir, 'agent-card.json')) {
            return entry.cardJson;
          }
        }
        return '';
      }) as typeof fs.readFileSync);
    }

    it('returns empty result when extensions directory does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const result = registry.loadExtensionCards('C:\\nope');
      expect(result.loaded).toEqual([]);
      expect(result.skipped).toEqual([]);
      expect(registry.getCards()).toHaveLength(0);
    });

    it('loads a valid card and registers it under extension:<name>', () => {
      const root = 'C:\\repo\\.github\\extensions';
      stubExtensionsDir(root, [{ dir: 'chamber-copilot', cardJson: JSON.stringify(VALID_CARD) }]);

      const result = registry.loadExtensionCards(root);

      expect(result.loaded).toEqual(['chamber-copilot']);
      expect(result.skipped).toEqual([]);
      expect(registry.getCard('extension:chamber-copilot')).not.toBeNull();
      expect(registry.getCardByName('chamber-copilot')?.version).toBe('0.1.0');
    });

    it('extension card resolves via getCardByName for routing', () => {
      const root = 'C:\\repo\\.github\\extensions';
      stubExtensionsDir(root, [{ dir: 'chamber-copilot', cardJson: JSON.stringify(VALID_CARD) }]);
      registry.loadExtensionCards(root);

      const card = registry.getCardByName('chamber-copilot');
      if (!card) throw new Error('expected card');
      expect(card.supportedInterfaces[0].protocolBinding).toBe('COPILOT_EXTENSION');
      expect(card.mindId).toBeUndefined();
    });

    it('skips entries without agent-card.json without throwing', () => {
      const root = 'C:\\repo\\.github\\extensions';
      stubExtensionsDir(root, [{ dir: 'no-card' }]);

      const result = registry.loadExtensionCards(root);

      expect(result.loaded).toEqual([]);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0]).toEqual({ dir: 'no-card', reason: 'no agent-card.json' });
    });

    it('skips malformed JSON without throwing', () => {
      const root = 'C:\\repo\\.github\\extensions';
      stubExtensionsDir(root, [{ dir: 'broken', cardJson: '{ not valid json' }]);

      const result = registry.loadExtensionCards(root);

      expect(result.loaded).toEqual([]);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0].dir).toBe('broken');
      expect(result.skipped[0].reason).toMatch(/invalid JSON/);
    });

    it('skips cards missing required fields', () => {
      const root = 'C:\\repo\\.github\\extensions';
      const incomplete = { name: 'partial', description: 'no version' };
      stubExtensionsDir(root, [{ dir: 'partial', cardJson: JSON.stringify(incomplete) }]);

      const result = registry.loadExtensionCards(root);

      expect(result.loaded).toEqual([]);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0].reason).toMatch(/missing required field/);
    });

    it('does not collide with in-process Mind cards', () => {
      const root = 'C:\\repo\\.github\\extensions';
      stubExtensionsDir(root, [{ dir: 'chamber-copilot', cardJson: JSON.stringify(VALID_CARD) }]);

      registry.register(makeMindContext({ mindId: 'q-123', identity: { name: 'Q', systemMessage: '' } }));
      registry.loadExtensionCards(root);

      expect(registry.getCard('q-123')?.name).toBe('Q');
      expect(registry.getCard('extension:chamber-copilot')?.name).toBe('chamber-copilot');
      expect(registry.getCards()).toHaveLength(2);
    });
  });
});

