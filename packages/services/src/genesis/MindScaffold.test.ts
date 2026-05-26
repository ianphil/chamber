import { describe, it, expect, vi } from 'vitest';
import { MindScaffold } from './MindScaffold';
import { approveForSessionCompat } from '../sdk/approveForSessionCompat';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
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

describe('MindScaffold chamber gitignore', () => {
  function makeMindPath(): string {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-mindscaffold-gitignore-'));
    return path.join(tmpDir, 'gitignore-mind');
  }

  function removeMindPath(mindPath: string): void {
    fs.rmSync(path.dirname(mindPath), { recursive: true, force: true });
  }

  function initGit(scaffold: MindScaffold, mindPath: string): void {
    const previousEnv = {
      GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME,
      GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL,
      GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME,
      GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL,
    };
    process.env.GIT_AUTHOR_NAME = 'Chamber Test';
    process.env.GIT_AUTHOR_EMAIL = 'chamber-test@example.invalid';
    process.env.GIT_COMMITTER_NAME = 'Chamber Test';
    process.env.GIT_COMMITTER_EMAIL = 'chamber-test@example.invalid';
    try {
      const git = scaffold as unknown as { initGit(mindPath: string): void };
      git.initGit(mindPath);
    } finally {
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  }

  it('commits .chamber/.gitignore with runtime history ignored during Genesis git init', () => {
    const mindPath = makeMindPath();
    try {
      fs.mkdirSync(path.join(mindPath, '.chamber', 'runs'), { recursive: true });
      fs.writeFileSync(path.join(mindPath, 'SOUL.md'), '# Soul\n');
      fs.writeFileSync(path.join(mindPath, '.chamber', 'runs', 'tasks.db'), 'db');
      fs.writeFileSync(path.join(mindPath, '.chamber', 'cron-runs.json'), '[]\n');
      fs.writeFileSync(path.join(mindPath, '.chamber', 'cron-runs.json.migrated-2026-05-21T000000000Z'), '[]\n');

      const scaffold = new MindScaffold(
        {} as unknown as GitHubRegistryClient,
        {} as unknown as CopilotClientFactory,
      );
      initGit(scaffold, mindPath);

      const gitignorePath = path.join(mindPath, '.chamber', '.gitignore');
      expect(fs.readFileSync(gitignorePath, 'utf8')).toBe(
        'runs/\ncron-runs.json\ncron-runs.json.migrated-*\n',
      );
      const committedFiles = execSync('git ls-tree --name-only -r HEAD', { cwd: mindPath, encoding: 'utf8' });
      expect(committedFiles).toContain('.chamber/.gitignore');
      expect(committedFiles).not.toContain('.chamber/runs/tasks.db');
      expect(committedFiles).not.toContain('.chamber/cron-runs.json');
      expect(committedFiles).not.toContain('.chamber/cron-runs.json.migrated-2026-05-21T000000000Z');
    } finally {
      removeMindPath(mindPath);
    }
  });

  it('adds .chamber/.gitignore to existing minds that already have .chamber state', () => {
    const mindPath = makeMindPath();
    try {
      fs.mkdirSync(path.join(mindPath, '.chamber'), { recursive: true });
      fs.writeFileSync(path.join(mindPath, '.chamber', 'cron.json'), '{"jobs":[]}\n');

      MindScaffold.ensureChamberGitignore(mindPath);

      expect(fs.readFileSync(path.join(mindPath, '.chamber', '.gitignore'), 'utf8')).toBe(
        'runs/\ncron-runs.json\ncron-runs.json.migrated-*\n',
      );
    } finally {
      removeMindPath(mindPath);
    }
  });

  it('creates .chamber/.gitignore for existing minds before runtime history exists', () => {
    const mindPath = makeMindPath();
    try {
      fs.mkdirSync(mindPath, { recursive: true });

      MindScaffold.ensureChamberGitignore(mindPath);

      expect(fs.readFileSync(path.join(mindPath, '.chamber', '.gitignore'), 'utf8')).toBe(
        'runs/\ncron-runs.json\ncron-runs.json.migrated-*\n',
      );
    } finally {
      removeMindPath(mindPath);
    }
  });

  it('does not rewrite an existing .chamber/.gitignore migration', () => {
    const mindPath = makeMindPath();
    try {
      fs.mkdirSync(path.join(mindPath, '.chamber'), { recursive: true });
      const gitignorePath = path.join(mindPath, '.chamber', '.gitignore');
      fs.writeFileSync(gitignorePath, 'runs/\ncron-runs.json\ncron-runs.json.migrated-*\ncustom/\n');

      MindScaffold.ensureChamberGitignore(mindPath);

      expect(fs.readFileSync(gitignorePath, 'utf8')).toBe(
        'runs/\ncron-runs.json\ncron-runs.json.migrated-*\ncustom/\n',
      );
    } finally {
      removeMindPath(mindPath);
    }
  });

  it('adds runtime history ignores to an existing .chamber/.gitignore without dropping custom entries', () => {
    const mindPath = makeMindPath();
    try {
      fs.mkdirSync(path.join(mindPath, '.chamber'), { recursive: true });
      const gitignorePath = path.join(mindPath, '.chamber', '.gitignore');
      fs.writeFileSync(gitignorePath, 'custom/\n');

      MindScaffold.ensureChamberGitignore(mindPath);

      expect(fs.readFileSync(gitignorePath, 'utf8')).toBe(
        'custom/\nruns/\ncron-runs.json\ncron-runs.json.migrated-*\n',
      );
    } finally {
      removeMindPath(mindPath);
    }
  });

  it('keeps git status clean when runs artifacts exist under .chamber', () => {
    const mindPath = makeMindPath();
    try {
      fs.mkdirSync(path.join(mindPath, '.chamber', 'runs'), { recursive: true });
      fs.writeFileSync(path.join(mindPath, 'SOUL.md'), '# Soul\n');
      fs.writeFileSync(path.join(mindPath, '.chamber', 'runs', 'tasks.db'), 'db');
      fs.writeFileSync(path.join(mindPath, '.chamber', 'cron-runs.json'), '[]\n');

      const scaffold = new MindScaffold(
        {} as unknown as GitHubRegistryClient,
        {} as unknown as CopilotClientFactory,
      );
      initGit(scaffold, mindPath);

      expect(execSync('git status --porcelain', { cwd: mindPath, encoding: 'utf8' })).toBe('');
    } finally {
      removeMindPath(mindPath);
    }
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

// v0.60.0 Phase 2: sentinel-seed becomes strict opt-in. The dream-daemon Switch
// in the Genesis wizard threads `enableDreamDaemon` through GenesisConfig →
// MindScaffold.createStructure. Opt-in seeds the sentinel exactly as before;
// opt-out leaves log.md as an empty placeholder so the WorkingMemoryComposer
// short-circuits cleanly (no read, no warn, no info — see Phase 1 enabled
// gate). The on-disk shape of a mind is owned by createStructure regardless
// of which Genesis path created the mind.
describe('MindScaffold.createStructure — log.md sentinel seed (opt-in)', () => {
  it('opt-in (enableDreamDaemon=true): seeds log.md with the chamber-structured-log/v1 sentinel as its first non-blank line', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-mindscaffold-sentinel-'));
    try {
      const mindPath = path.join(tmpDir, 'mind');
      const scaffold = new MindScaffold(
        {} as unknown as GitHubRegistryClient,
        {} as unknown as CopilotClientFactory,
      );

      const internal = scaffold as unknown as {
        createStructure(mp: string, opts: { enableDreamDaemon: boolean }): void;
      };
      internal.createStructure(mindPath, { enableDreamDaemon: true });

      const logPath = path.join(mindPath, '.working-memory', 'log.md');
      expect(fs.existsSync(logPath)).toBe(true);
      const content = fs.readFileSync(logPath, 'utf-8');
      const firstNonBlank = content.split('\n').find((l) => l.trim() !== '');
      expect(firstNonBlank).toBe(STRUCTURED_LOG_SENTINEL);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('opt-in: leaves the seeded sentinel intact even though WORKING_MEMORY_FILES still iterates log.md', () => {
    // Guard against accidental regression: if the WORKING_MEMORY_FILES loop
    // ran AFTER the seed without the existsSync guard, log.md would be blanked.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-mindscaffold-sentinel-'));
    try {
      const mindPath = path.join(tmpDir, 'mind');
      const scaffold = new MindScaffold(
        {} as unknown as GitHubRegistryClient,
        {} as unknown as CopilotClientFactory,
      );

      const internal = scaffold as unknown as {
        createStructure(mp: string, opts: { enableDreamDaemon: boolean }): void;
      };
      internal.createStructure(mindPath, { enableDreamDaemon: true });

      const logPath = path.join(mindPath, '.working-memory', 'log.md');
      const content = fs.readFileSync(logPath, 'utf-8');
      expect(content.length).toBeGreaterThan(0);
      expect(content).toContain(STRUCTURED_LOG_SENTINEL);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('opt-out (enableDreamDaemon=false): log.md exists but is empty (no sentinel)', () => {
    // When the user does NOT opt in, the structured-log sentinel must NOT be
    // written. Otherwise a never-opted-in mind would have a sentinel byte
    // sitting on disk that would activate DailyLogWriter's structured path on
    // the first turn — defeating the opt-in. The placeholder loop still
    // creates log.md (so paths are valid) but its content is exactly empty.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-mindscaffold-sentinel-'));
    try {
      const mindPath = path.join(tmpDir, 'mind');
      const scaffold = new MindScaffold(
        {} as unknown as GitHubRegistryClient,
        {} as unknown as CopilotClientFactory,
      );

      const internal = scaffold as unknown as {
        createStructure(mp: string, opts: { enableDreamDaemon: boolean }): void;
      };
      internal.createStructure(mindPath, { enableDreamDaemon: false });

      const logPath = path.join(mindPath, '.working-memory', 'log.md');
      expect(fs.existsSync(logPath)).toBe(true);
      const content = fs.readFileSync(logPath, 'utf-8');
      expect(content).toBe('');
      expect(content).not.toContain(STRUCTURED_LOG_SENTINEL);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('opt-out: omitting `enableDreamDaemon` defaults to OFF (defense-in-depth)', () => {
    // The Genesis IPC schema forwards the field explicitly, but if a future
    // refactor or a programmatic call drops the flag we must default to the
    // safer (off) state. Strict opt-in: anything other than `true` means OFF.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-mindscaffold-sentinel-'));
    try {
      const mindPath = path.join(tmpDir, 'mind');
      const scaffold = new MindScaffold(
        {} as unknown as GitHubRegistryClient,
        {} as unknown as CopilotClientFactory,
      );

      const internal = scaffold as unknown as {
        createStructure(mp: string, opts?: { enableDreamDaemon?: boolean }): void;
      };
      internal.createStructure(mindPath);

      const logPath = path.join(mindPath, '.working-memory', 'log.md');
      const content = fs.readFileSync(logPath, 'utf-8');
      expect(content).toBe('');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// v0.60.0 Phase 2: opt-in must persist the choice into `.chamber.json` so
// MindMemoryService.activateMind can read it back on the very next mind
// load. Opt-out is the default (no consolidation block) so existing minds
// upgrading into this release stay opted-out without a migration. We deep-
// merge in case future Genesis features write other fields.
describe('MindScaffold.create — `.chamber.json` consolidation block (opt-in)', () => {
  it('opt-in: writes .chamber.json with workingMemory.consolidation.enabled=true', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-mindscaffold-chamberjson-'));
    try {
      const mindPath = path.join(tmpDir, 'mind');
      const scaffold = new MindScaffold(
        {} as unknown as GitHubRegistryClient,
        {} as unknown as CopilotClientFactory,
      );

      const internal = scaffold as unknown as {
        createStructure(mp: string, opts: { enableDreamDaemon: boolean }): void;
      };
      internal.createStructure(mindPath, { enableDreamDaemon: true });

      const chamberJsonPath = path.join(mindPath, '.chamber.json');
      expect(fs.existsSync(chamberJsonPath)).toBe(true);
      const parsed = JSON.parse(fs.readFileSync(chamberJsonPath, 'utf-8')) as {
        workingMemory?: { consolidation?: { enabled?: unknown } };
      };
      expect(parsed.workingMemory?.consolidation?.enabled).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('opt-out: does NOT write .chamber.json (defaults are off → file is absent)', () => {
    // No file = chamberMindConfig.loadChamberMindConfig returns the default
    // shape with `consolidation.enabled: false`. Writing an empty marker file
    // would be wasted I/O AND signal intent the user never expressed.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-mindscaffold-chamberjson-'));
    try {
      const mindPath = path.join(tmpDir, 'mind');
      const scaffold = new MindScaffold(
        {} as unknown as GitHubRegistryClient,
        {} as unknown as CopilotClientFactory,
      );

      const internal = scaffold as unknown as {
        createStructure(mp: string, opts: { enableDreamDaemon: boolean }): void;
      };
      internal.createStructure(mindPath, { enableDreamDaemon: false });

      const chamberJsonPath = path.join(mindPath, '.chamber.json');
      expect(fs.existsSync(chamberJsonPath)).toBe(false);
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
