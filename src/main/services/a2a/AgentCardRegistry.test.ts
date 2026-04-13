import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import type { MindContext } from '../../../shared/types';

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
  let emitter: EventEmitter;
  let registry: AgentCardRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    emitter = new EventEmitter();
    registry = new AgentCardRegistry(emitter);
  });

  it('registers card when mind:loaded fires', () => {
    registry.register(makeMindContext());
    const card = registry.getCard('q-123');
    expect(card).not.toBeNull();
    expect(card!.name).toBe('Q');
  });

  it('AgentCard has all required A2A fields', () => {
    registry.register(makeMindContext());
    const card = registry.getCard('q-123')!;

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
    const iface = registry.getCard('q-123')!.supportedInterfaces[0];

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
    expect(card!.mindId).toBe('q-123');
  });

  it('getCardByName() returns null for ambiguous names', () => {
    registry.register(makeMindContext({ mindId: 'q-1', identity: { name: 'Q', systemMessage: '' } }));
    registry.register(makeMindContext({ mindId: 'q-2', identity: { name: 'Q', systemMessage: '' } }));

    expect(registry.getCardByName('Q')).toBeNull();
  });

  it('discovers skills from .github/skills/ directories', () => {
    const mindPath = 'C:\\src\\q';
    const skillsDir = `${mindPath}\\.github\\skills`;

    vi.mocked(fs.existsSync).mockImplementation((p: fs.PathLike) => {
      const s = String(p);
      if (s.endsWith('.github\\skills')) return true;
      if (s.endsWith('commit\\SKILL.md')) return true;
      if (s.endsWith('teams\\SKILL.md')) return true;
      return false;
    });

    vi.mocked(fs.readdirSync).mockImplementation(((p: string) => {
      if (String(p).endsWith('.github\\skills')) {
        return [
          { name: 'commit', isDirectory: () => true },
          { name: 'teams', isDirectory: () => true },
        ] as unknown as fs.Dirent[];
      }
      return [];
    }) as typeof fs.readdirSync);

    vi.mocked(fs.readFileSync).mockImplementation(((p: string) => {
      if (String(p).endsWith('commit\\SKILL.md')) return '# Commit\nCommits changes to git.';
      if (String(p).endsWith('teams\\SKILL.md')) return '# Teams\nSend messages via Teams.';
      return '';
    }) as typeof fs.readFileSync);

    registry.register(makeMindContext({ mindPath }));
    const card = registry.getCard('q-123')!;

    expect(card.skills).toHaveLength(2);

    const commit = card.skills.find((s) => s.id === 'commit')!;
    expect(commit.name).toBe('Commit');
    expect(commit.description).toBe('Commits changes to git.');
    expect(commit.tags).toContain('commit');

    const teams = card.skills.find((s) => s.id === 'teams')!;
    expect(teams.name).toBe('Teams');
    expect(teams.description).toBe('Send messages via Teams.');
    expect(teams.tags).toContain('teams');
  });
});

