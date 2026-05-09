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

  it('registers loopback HTTP+JSON remote cards separately from local mind cards', () => {
    registry.register(makeMindContext({ mindId: 'q-123', identity: { name: 'Q', systemMessage: '' } }));

    registry.registerRemote({
      name: 'Copilot CLI',
      description: 'CLI peer',
      version: '1.0.0',
      supportedInterfaces: [{ url: 'http://127.0.0.1:4123', protocolBinding: 'HTTP+JSON', protocolVersion: '1.0' }],
      capabilities: {},
      defaultInputModes: ['text/plain'],
      defaultOutputModes: ['text/plain'],
      skills: [],
    });

    expect(registry.getCard('q-123')?.mindId).toBe('q-123');
    expect(registry.getCard('Copilot CLI')?.name).toBe('Copilot CLI');
    expect(registry.getCards().map((card) => card.name)).toEqual(['Q', 'Copilot CLI']);
  });

  it('stores remote auth separately from public agent cards', () => {
    registry.registerRemote({
      name: 'Copilot CLI',
      description: 'CLI peer',
      version: '1.0.0',
      supportedInterfaces: [{ url: 'http://127.0.0.1:4123', protocolBinding: 'HTTP+JSON', protocolVersion: '1.0' }],
      capabilities: {},
      defaultInputModes: ['text/plain'],
      defaultOutputModes: ['text/plain'],
      skills: [],
    }, { scheme: 'bearer', token: 'secret-token' });

    expect(registry.getRemoteAuth('Copilot CLI')).toEqual({ scheme: 'bearer', token: 'secret-token' });
    expect(JSON.stringify(registry.getCard('Copilot CLI'))).not.toContain('secret-token');
    expect(JSON.stringify(registry.getCards())).not.toContain('secret-token');
  });

  it('rejects remote cards that would collide with local card identifiers', () => {
    registry.register(makeMindContext({ mindId: 'q-123', identity: { name: 'Q', systemMessage: '' } }));

    expect(() => registry.registerRemote({
      name: 'q-123',
      description: 'Bad peer',
      version: '1.0.0',
      supportedInterfaces: [{ url: 'http://127.0.0.1:4123', protocolBinding: 'HTTP+JSON', protocolVersion: '1.0' }],
      capabilities: {},
      defaultInputModes: ['text/plain'],
      defaultOutputModes: ['text/plain'],
      skills: [],
    })).toThrow(/conflicts/);
  });

  it('rejects remote cards with non-loopback HTTP interfaces', () => {
    expect(() => registry.registerRemote({
      name: 'Remote',
      description: 'Bad peer',
      version: '1.0.0',
      supportedInterfaces: [{ url: 'https://example.com/a2a', protocolBinding: 'HTTP+JSON', protocolVersion: '1.0' }],
      capabilities: {},
      defaultInputModes: ['text/plain'],
      defaultOutputModes: ['text/plain'],
      skills: [],
    })).toThrow(/loopback HTTP/);
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
});
