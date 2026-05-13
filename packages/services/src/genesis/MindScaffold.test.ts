import { describe, it, expect, vi } from 'vitest';
import { MindScaffold } from './MindScaffold';
import { approveForSessionCompat } from '../sdk/approveForSessionCompat';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { CopilotClientFactory } from '../sdk/CopilotClientFactory';
import type { GitHubRegistryClient } from './GitHubRegistryClient';
import { STRUCTURED_LOG_SENTINEL } from '../mindMemory/StructuredLogFormat';

describe('MindScaffold.slugify', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(MindScaffold.slugify('My Agent')).toBe('my-agent');
  });

  it('strips special characters', () => {
    expect(MindScaffold.slugify('Hello World!')).toBe('hello-world');
  });

  it('trims leading and trailing hyphens', () => {
    expect(MindScaffold.slugify('--test--')).toBe('test');
  });

  it('collapses consecutive hyphens', () => {
    expect(MindScaffold.slugify('a---b')).toBe('a-b');
  });

  it('strips non-ascii characters', () => {
    expect(MindScaffold.slugify('café ☕')).toBe('caf');
  });

  it('returns empty string for empty input', () => {
    expect(MindScaffold.slugify('')).toBe('');
  });

  it('handles all-special-char input', () => {
    expect(MindScaffold.slugify('!@#$%')).toBe('');
  });

  it('caps the slug at 40 characters', () => {
    const long = 'a'.repeat(60);
    expect(MindScaffold.slugify(long)).toHaveLength(40);
  });

  it('trims trailing hyphens left by truncation', () => {
    // 39 a's + ' z' → 'a*39-z' (41 chars) → slice(0,40) lands a trailing dash
    // that should be cleaned up so we don't ship a path ending in '-'.
    expect(MindScaffold.slugify('a'.repeat(39) + ' z')).toBe('a'.repeat(39));
  });
});

describe('MindScaffold.create', () => {
  it('throws when the target mind directory already exists', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-mindscaffold-'));
    try {
      const slug = MindScaffold.slugify('Existing Mind');
      fs.mkdirSync(path.join(tmpDir, slug), { recursive: true });

      const scaffold = new MindScaffold(
        {} as unknown as GitHubRegistryClient,
        {} as unknown as CopilotClientFactory,
      );

      await expect(
        scaffold.create({
          name: 'Existing Mind',
          role: 'tester',
          voice: 'plain',
          voiceDescription: 'plain',
          basePath: tmpDir,
        }),
      ).rejects.toThrow(/already exists/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('injects current datetime context into the genesis prompt', async () => {
    const session = {
      send: vi.fn<(_: { prompt: string }) => Promise<void>>(async () => undefined),
      destroy: vi.fn(async () => undefined),
      on: vi.fn((event: string, callback: () => void) => {
        if (event === 'session.idle') setTimeout(callback, 0);
        return vi.fn();
      }),
      rpc: { permissions: { setApproveAll: vi.fn(async () => ({ success: true })) } },
    };
    const client = { createSession: vi.fn(async () => session) };
    const clientFactory = {
      createClient: vi.fn(async () => client),
      destroyClient: vi.fn(async () => undefined),
    } as unknown as CopilotClientFactory;
    const scaffold = new MindScaffold(
      {} as unknown as GitHubRegistryClient,
      clientFactory,
    );

    const generateSoul = scaffold as unknown as {
      generateSoul(mindPath: string, config: Parameters<MindScaffold['create']>[0], slug: string): Promise<void>;
    };
    const promise = generateSoul.generateSoul('/tmp/minds/bob', {
      name: 'Bob',
      role: 'reviewer',
      voice: 'direct',
      voiceDescription: 'direct',
      basePath: '/tmp/minds',
    }, 'bob');
    await promise;

    const sentPrompt = session.send.mock.calls[0]?.[0]?.prompt;
    expect(sentPrompt).toEqual(expect.stringContaining('<current_datetime>'));
    expect(sentPrompt).toEqual(expect.stringContaining('<timezone>'));
    expect(sentPrompt).toEqual(expect.stringContaining('Bob'));
  });

  it('wires approveForSessionCompat for genesis sessions and does not short-circuit via setApproveAll (issue #131)', async () => {
    const session = {
      send: vi.fn<(_: { prompt: string }) => Promise<void>>(async () => undefined),
      destroy: vi.fn(async () => undefined),
      on: vi.fn((event: string, callback: () => void) => {
        if (event === 'session.idle') setTimeout(callback, 0);
        return vi.fn();
      }),
      rpc: { permissions: { setApproveAll: vi.fn(async () => ({ success: true })) } },
    };
    const createSession = vi.fn<(_: Record<string, unknown>) => Promise<typeof session>>(async () => session);
    const client = { createSession };
    const clientFactory = {
      createClient: vi.fn(async () => client),
      destroyClient: vi.fn(async () => undefined),
    } as unknown as CopilotClientFactory;
    const scaffold = new MindScaffold(
      {} as unknown as GitHubRegistryClient,
      clientFactory,
    );

    const generateSoul = scaffold as unknown as {
      generateSoul(mindPath: string, config: Parameters<MindScaffold['create']>[0], slug: string): Promise<void>;
    };
    await generateSoul.generateSoul('/tmp/minds/zed', {
      name: 'Zed',
      role: 'reviewer',
      voice: 'direct',
      voiceDescription: 'direct',
      basePath: '/tmp/minds',
    }, 'zed');

    const sessionConfig = createSession.mock.calls[0]?.[0] as { onPermissionRequest?: unknown } | undefined;
    expect(sessionConfig?.onPermissionRequest).toBe(approveForSessionCompat);
    expect(session.rpc.permissions.setApproveAll).not.toHaveBeenCalled();
  });
});

describe('MindScaffold.getDefaultBasePath', () => {
  it('returns homedir/agents', () => {
    expect(MindScaffold.getDefaultBasePath()).toBe(path.join(os.homedir(), 'agents'));
  });
});

describe('MindScaffold constructor', () => {
  it('accepts an injected CopilotClientFactory', () => {
    const fakeFactory = { createClient: async () => ({}), destroyClient: async () => { /* noop */ } } as unknown as CopilotClientFactory;
    const scaffold = new MindScaffold(undefined, fakeFactory);
    expect(scaffold).toBeDefined();
  });
});

// The upgrade skill lives in ianphil/genesis-frontier@main as of 2026-04-24
// (Epic #67). Calling against the legacy ianphil/genesis repo silently throws
// "Upgrade skill not found in genesis repo" and leaves new minds without the
// bootloader. The tests below lock the source coordinate so a future rename or
// typo is caught at the unit level.
describe('MindScaffold.bootstrapCapabilities — registry source', () => {
  function makeFakeRegistryClient() {
    const calls: { fetchTree: Array<[string, string, string]>; fetchJsonContent: Array<[string, string, string, string]> } = {
      fetchTree: [],
      fetchJsonContent: [],
    };
    const tree = [
      { path: '.github/skills/upgrade/upgrade.js', type: 'blob', sha: 'sha-upgrade-js' },
      { path: '.github/skills/upgrade/skill.json', type: 'blob', sha: 'sha-upgrade-json' },
    ];
    const client = {
      fetchTree: vi.fn(async (owner: string, repo: string, branch: string) => {
        calls.fetchTree.push([owner, repo, branch]);
        return tree;
      }),
      fetchBlob: vi.fn(async () => Buffer.from('// stub upgrade content', 'utf8')),
      fetchJsonContent: vi.fn(async (owner: string, repo: string, file: string, ref: string) => {
        calls.fetchJsonContent.push([owner, repo, file, ref]);
        return { skills: { upgrade: { version: '1.0.0', description: 'stub' } } };
      }),
    } as unknown as GitHubRegistryClient;
    return { client, calls };
  }

  it('pullUpgradeSkill fetches the tree from ianphil/genesis-frontier@main', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-mindscaffold-source-'));
    try {
      const mindPath = path.join(tmpDir, 'mind');
      fs.mkdirSync(path.join(mindPath, '.github'), { recursive: true });
      fs.writeFileSync(
        path.join(mindPath, '.github', 'registry.json'),
        JSON.stringify({ version: '0.0.0', source: 'placeholder', channel: 'main', extensions: {}, skills: {}, prompts: {}, packages: [] }, null, 2),
      );

      const { client, calls } = makeFakeRegistryClient();
      const scaffold = new MindScaffold(client, {} as unknown as CopilotClientFactory);

      const internal = scaffold as unknown as { pullUpgradeSkill(mp: string): Promise<unknown> };
      await internal.pullUpgradeSkill(mindPath);

      expect(calls.fetchTree).toHaveLength(1);
      expect(calls.fetchTree[0]).toEqual(['ianphil', 'genesis-frontier', 'main']);
      expect(calls.fetchJsonContent[0]?.slice(0, 3)).toEqual(['ianphil', 'genesis-frontier', '.github/registry.json']);
      expect(calls.fetchJsonContent[0]?.[3]).toBe('main');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('seedRegistry writes source: ianphil/genesis-frontier', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-mindscaffold-source-'));
    try {
      const mindPath = path.join(tmpDir, 'mind');
      fs.mkdirSync(path.join(mindPath, '.github'), { recursive: true });

      const { client } = makeFakeRegistryClient();
      const scaffold = new MindScaffold(client, {} as unknown as CopilotClientFactory);

      const internal = scaffold as unknown as { bootstrapCapabilities(mp: string): Promise<void> };
      // bootstrapCapabilities will fail at the execSync step (upgrade.js exec), but
      // by then seedRegistry has already written the registry.json. We only care
      // about that file's contents here.
      await internal.bootstrapCapabilities(mindPath).catch(() => { /* expected */ });

      const reg = JSON.parse(fs.readFileSync(path.join(mindPath, '.github', 'registry.json'), 'utf8'));
      expect(reg.source).toBe('ianphil/genesis-frontier');
      expect(reg.channel).toBe('main');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('pullUpgradeSkill error message names the searched owner/repo/branch when the skill is missing', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-mindscaffold-source-'));
    try {
      const mindPath = path.join(tmpDir, 'mind');
      fs.mkdirSync(path.join(mindPath, '.github'), { recursive: true });
      fs.writeFileSync(
        path.join(mindPath, '.github', 'registry.json'),
        JSON.stringify({ version: '0.0.0', source: 'placeholder', channel: 'main', extensions: {}, skills: {}, prompts: {}, packages: [] }, null, 2),
      );

      const emptyTreeClient = {
        fetchTree: vi.fn(async () => [
          { path: '.github/skills/commit/commit.js', type: 'blob', sha: 'sha-commit' },
        ]),
        fetchBlob: vi.fn(async () => Buffer.from('')),
        fetchJsonContent: vi.fn(async () => ({})),
      } as unknown as GitHubRegistryClient;

      const scaffold = new MindScaffold(emptyTreeClient, {} as unknown as CopilotClientFactory);
      const internal = scaffold as unknown as { pullUpgradeSkill(mp: string): Promise<unknown> };

      await expect(internal.pullUpgradeSkill(mindPath)).rejects.toThrow(/ianphil\/genesis-frontier@main/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// Fix 2: a new mind's .working-memory/log.md must be sentinel-prefixed from the
// moment createStructure() runs. Otherwise WorkingMemoryComposer emits the
// "log.md is unstructured" warning on every system-prompt rebuild for the
// lifetime of the mind, and DailyLogWriter has to rotate the legacy line on
// first turn. Seeding from MindScaffold owns the on-disk shape of a mind.
describe('MindScaffold.createStructure — log.md sentinel seed', () => {
  it('seeds log.md with the chamber-structured-log/v1 sentinel as its first non-blank line', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-mindscaffold-sentinel-'));
    try {
      const mindPath = path.join(tmpDir, 'mind');
      const scaffold = new MindScaffold(
        {} as unknown as GitHubRegistryClient,
        {} as unknown as CopilotClientFactory,
      );

      const internal = scaffold as unknown as { createStructure(mp: string): void };
      internal.createStructure(mindPath);

      const logPath = path.join(mindPath, '.working-memory', 'log.md');
      expect(fs.existsSync(logPath)).toBe(true);
      const content = fs.readFileSync(logPath, 'utf-8');
      const firstNonBlank = content.split('\n').find((l) => l.trim() !== '');
      expect(firstNonBlank).toBe(STRUCTURED_LOG_SENTINEL);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('leaves the seeded sentinel intact even though WORKING_MEMORY_FILES still iterates log.md', () => {
    // Guard against accidental regression: if the WORKING_MEMORY_FILES loop
    // ran AFTER the seed without the existsSync guard, log.md would be blanked.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-mindscaffold-sentinel-'));
    try {
      const mindPath = path.join(tmpDir, 'mind');
      const scaffold = new MindScaffold(
        {} as unknown as GitHubRegistryClient,
        {} as unknown as CopilotClientFactory,
      );

      const internal = scaffold as unknown as { createStructure(mp: string): void };
      internal.createStructure(mindPath);

      const logPath = path.join(mindPath, '.working-memory', 'log.md');
      const content = fs.readFileSync(logPath, 'utf-8');
      expect(content.length).toBeGreaterThan(0);
      expect(content).toContain(STRUCTURED_LOG_SENTINEL);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// Fix 2: the genesis prompt must not instruct the LLM to write to log.md any
// more — that file is reserved for structured CompletedTurn frames produced by
// DailyLogWriter. The "I am born" observation in genesis is deliberately
// dropped (recorded by the "Genesis" git commit and SOUL.md instead).
describe('MindScaffold.generateSoul — genesis prompt no longer references log.md', () => {
  it('does not pass log.md as a write target to buildGenesisPrompt', async () => {
    const session = {
      send: vi.fn<(_: { prompt: string }) => Promise<void>>(async () => undefined),
      destroy: vi.fn(async () => undefined),
      on: vi.fn((event: string, callback: () => void) => {
        if (event === 'session.idle') setTimeout(callback, 0);
        return vi.fn();
      }),
      rpc: { permissions: { setApproveAll: vi.fn(async () => ({ success: true })) } },
    };
    const client = { createSession: vi.fn(async () => session) };
    const clientFactory = {
      createClient: vi.fn(async () => client),
      destroyClient: vi.fn(async () => undefined),
    } as unknown as CopilotClientFactory;
    const scaffold = new MindScaffold(
      {} as unknown as GitHubRegistryClient,
      clientFactory,
    );

    const generateSoul = scaffold as unknown as {
      generateSoul(mindPath: string, config: Parameters<MindScaffold['create']>[0], slug: string): Promise<void>;
    };
    await generateSoul.generateSoul('/tmp/minds/seed', {
      name: 'Seed',
      role: 'reviewer',
      voice: 'plain',
      voiceDescription: 'plain',
      basePath: '/tmp/minds',
    }, 'seed');

    const sentPrompt = session.send.mock.calls[0]?.[0]?.prompt ?? '';
    expect(sentPrompt).not.toContain('log.md');
    expect(sentPrompt).toContain('SOUL.md');
    expect(sentPrompt).toContain('memory.md');
    expect(sentPrompt).toContain('rules.md');
  });
});
