import { describe, it, expect, vi } from 'vitest';
import { MindScaffold } from './MindScaffold';
import { approveForSessionCompat } from '../sdk/approveForSessionCompat';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import type { CopilotClientFactory } from '../sdk/CopilotClientFactory';
import type { GitHubRegistryClient } from './GitHubRegistryClient';

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
      disconnect: vi.fn(async () => undefined),
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
      disconnect: vi.fn(async () => undefined),
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
