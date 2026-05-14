/**
 * MindScaffold bootstrap integration smoke.
 *
 * Goal: lock in the dream-daemon contract that a freshly-scaffolded mind is
 * born with a structured `log.md` (chamber-structured-log/v1 sentinel) and a
 * registry pointing at `ianphil/genesis-frontier`. Exercises the full
 * `MindScaffold.create()` path against a tmpdir with the network and SDK
 * mocked, then verifies the on-disk state plus downstream consumer behaviour
 * (DailyLogWriter, WorkingMemoryComposer).
 *
 * Why integration? The MindScaffold unit tests mock `fs` and can't see the
 * actual byte-level contract on disk. This test runs real `fs` against a
 * tmpdir so a future regression (e.g. someone "optimizing" the seed write
 * away, or the WORKING_MEMORY_FILES loop re-blanking log.md) gets caught
 * here.
 *
 * Filesystem hygiene: every assertion group runs against a fresh tmpdir,
 * cleaned up in `afterEach`. ZERO writes to `~/agents` or any user-visible
 * location.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  MindScaffold,
  STRUCTURED_LOG_SENTINEL,
  createDailyLogWriter,
  createWorkingMemoryComposer,
  type CompletedTurn,
  type CopilotClientFactory,
  type GitHubRegistryClient,
} from '@chamber/services';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-mindscaffold-int-'));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

interface RegistryCallLog {
  fetchTree: Array<[string, string, string]>;
  fetchBlob: Array<[string, string, string]>;
  fetchJsonContent: Array<[string, string, string, string]>;
}

function makeFakeRegistryClient(callLog: RegistryCallLog): GitHubRegistryClient {
  // A minimal valid upgrade.js so initGit's commit doesn't fail and the
  // bootstrapCapabilities exec path can either run or be skipped cleanly.
  // Returning {skills:{}} from fetchJsonContent means skillNames is empty and
  // bootstrapCapabilities exits before invoking execSync on upgrade.js.
  const tree = [
    { path: '.github/skills/upgrade/upgrade.js', type: 'blob', sha: 'sha-upgrade-js' },
    { path: '.github/skills/upgrade/skill.json', type: 'blob', sha: 'sha-upgrade-json' },
  ];
  return {
    fetchTree: vi.fn(async (owner: string, repo: string, branch: string) => {
      callLog.fetchTree.push([owner, repo, branch]);
      return tree;
    }),
    fetchBlob: vi.fn(async (owner: string, repo: string, sha: string) => {
      callLog.fetchBlob.push([owner, repo, sha]);
      if (sha === 'sha-upgrade-js') {
        return Buffer.from('// stub upgrade bootloader\nprocess.exit(0);\n', 'utf8');
      }
      return Buffer.from('{"name":"upgrade","version":"1.0.0"}\n', 'utf8');
    }),
    fetchJsonContent: vi.fn(async (owner: string, repo: string, filePath: string, ref: string) => {
      callLog.fetchJsonContent.push([owner, repo, filePath, ref]);
      // No remote skills besides the bootloader itself → bootstrapCapabilities
      // early-returns without execSync.
      return { skills: {} };
    }),
  } as unknown as GitHubRegistryClient;
}

interface SoulPaths {
  soul: string;
  agent: string;
  memory: string;
  rules: string;
  index: string;
}

// A fake session that, on `send()`, synchronously writes the minimal set of
// files genesis-prompt would otherwise drive the LLM to write. This keeps
// `validate()` happy so the test exercises the full create() path including
// initGit and bootstrapCapabilities.
function makeFakeClientFactory(seedFiles: (paths: SoulPaths) => void): CopilotClientFactory {
  return {
    createClient: vi.fn(async (mindPath: string) => {
      const slug = path.basename(mindPath);
      const paths: SoulPaths = {
        soul: path.join(mindPath, 'SOUL.md'),
        agent: path.join(mindPath, '.github', 'agents', `${slug}.agent.md`),
        memory: path.join(mindPath, '.working-memory', 'memory.md'),
        rules: path.join(mindPath, '.working-memory', 'rules.md'),
        index: path.join(mindPath, 'mind-index.md'),
      };
      const session = {
        send: vi.fn(async () => {
          seedFiles(paths);
        }),
        destroy: vi.fn(async () => undefined),
        on: vi.fn((event: string, callback: () => void) => {
          if (event === 'session.idle') setTimeout(callback, 0);
          return vi.fn();
        }),
        rpc: { permissions: { setApproveAll: vi.fn(async () => ({ success: true })) } },
      };
      return { createSession: vi.fn(async () => session) };
    }),
    destroyClient: vi.fn(async () => undefined),
  } as unknown as CopilotClientFactory;
}

function defaultSeedFiles(paths: SoulPaths): void {
  fs.writeFileSync(paths.soul, '# Test Soul\n\nA mind for tests.\n');
  fs.writeFileSync(paths.agent, '---\nname: test\ndescription: test\n---\n');
  fs.writeFileSync(paths.memory, '# Memory\n');
  fs.writeFileSync(paths.rules, '# Rules\n');
  fs.writeFileSync(paths.index, '# Mind Index\n');
}

describe('MindScaffold.create — bootstrap integration', () => {
  it('opt-in (enableDreamDaemon=true): produces a sentinel-prefixed log.md AND writes .chamber.json with consolidation.enabled=true', async () => {
    const callLog: RegistryCallLog = { fetchTree: [], fetchBlob: [], fetchJsonContent: [] };
    const scaffold = new MindScaffold(
      makeFakeRegistryClient(callLog),
      makeFakeClientFactory(defaultSeedFiles),
    );

    const mindPath = await scaffold.create({
      name: 'Sentinel Mind',
      role: 'integration tester',
      voice: 'plain',
      voiceDescription: 'plain',
      basePath: tmpRoot,
      enableDreamDaemon: true,
    });

    const logPath = path.join(mindPath, '.working-memory', 'log.md');
    expect(fs.existsSync(logPath)).toBe(true);
    const content = fs.readFileSync(logPath, 'utf-8');
    const firstNonBlank = content.split('\n').find((l) => l.trim() !== '');
    expect(firstNonBlank).toBe(STRUCTURED_LOG_SENTINEL);

    // Persist the opt-in choice so MindMemoryService.activateMind reads it
    // back on the next mind load — without this, the user toggled the
    // Switch but the daemon would never start.
    const chamberJsonPath = path.join(mindPath, '.chamber.json');
    expect(fs.existsSync(chamberJsonPath)).toBe(true);
    const chamberConfig = JSON.parse(fs.readFileSync(chamberJsonPath, 'utf-8')) as {
      workingMemory?: { consolidation?: { enabled?: unknown } };
    };
    expect(chamberConfig.workingMemory?.consolidation?.enabled).toBe(true);
  });

  it('opt-out (enableDreamDaemon=false): log.md is empty AND .chamber.json is absent', async () => {
    // Default flow for users who don't opt in. The mind still works (chat,
    // tools, memory, rules) — it just doesn't run the dream daemon and
    // doesn't materialize structured-log frames on each turn.
    const callLog: RegistryCallLog = { fetchTree: [], fetchBlob: [], fetchJsonContent: [] };
    const scaffold = new MindScaffold(
      makeFakeRegistryClient(callLog),
      makeFakeClientFactory(defaultSeedFiles),
    );

    const mindPath = await scaffold.create({
      name: 'Quiet Mind',
      role: 'integration tester',
      voice: 'plain',
      voiceDescription: 'plain',
      basePath: tmpRoot,
      enableDreamDaemon: false,
    });

    const logPath = path.join(mindPath, '.working-memory', 'log.md');
    expect(fs.existsSync(logPath)).toBe(true);
    expect(fs.readFileSync(logPath, 'utf-8')).toBe('');
    expect(fs.existsSync(path.join(mindPath, '.chamber.json'))).toBe(false);
  });

  it('records source: ianphil/genesis-frontier in registry.json', async () => {
    const callLog: RegistryCallLog = { fetchTree: [], fetchBlob: [], fetchJsonContent: [] };
    const scaffold = new MindScaffold(
      makeFakeRegistryClient(callLog),
      makeFakeClientFactory(defaultSeedFiles),
    );

    const mindPath = await scaffold.create({
      name: 'Frontier Mind',
      role: 'integration tester',
      voice: 'plain',
      voiceDescription: 'plain',
      basePath: tmpRoot,
    });

    const registry = JSON.parse(
      fs.readFileSync(path.join(mindPath, '.github', 'registry.json'), 'utf-8'),
    );
    expect(registry.source).toBe('ianphil/genesis-frontier');
    expect(registry.channel).toBe('main');
  });

  it('pulls the upgrade skill from ianphil/genesis-frontier and writes upgrade.js on disk', async () => {
    const callLog: RegistryCallLog = { fetchTree: [], fetchBlob: [], fetchJsonContent: [] };
    const scaffold = new MindScaffold(
      makeFakeRegistryClient(callLog),
      makeFakeClientFactory(defaultSeedFiles),
    );

    const mindPath = await scaffold.create({
      name: 'Upgrade Mind',
      role: 'integration tester',
      voice: 'plain',
      voiceDescription: 'plain',
      basePath: tmpRoot,
    });

    // Network coordinates
    expect(callLog.fetchTree).toEqual([['ianphil', 'genesis-frontier', 'main']]);
    // On-disk artifact
    const upgradeJs = path.join(mindPath, '.github', 'skills', 'upgrade', 'upgrade.js');
    expect(fs.existsSync(upgradeJs)).toBe(true);
    expect(fs.readFileSync(upgradeJs, 'utf-8')).toContain('stub upgrade bootloader');
  });

  it('lays down the full IDEA + .github + working-memory structure', async () => {
    const callLog: RegistryCallLog = { fetchTree: [], fetchBlob: [], fetchJsonContent: [] };
    const scaffold = new MindScaffold(
      makeFakeRegistryClient(callLog),
      makeFakeClientFactory(defaultSeedFiles),
    );

    const mindPath = await scaffold.create({
      name: 'Structure Mind',
      role: 'integration tester',
      voice: 'plain',
      voiceDescription: 'plain',
      basePath: tmpRoot,
    });

    for (const folder of ['inbox', 'domains', 'expertise', 'initiatives', 'Archive']) {
      expect(fs.existsSync(path.join(mindPath, folder))).toBe(true);
    }
    expect(fs.existsSync(path.join(mindPath, '.github', 'agents'))).toBe(true);
    expect(fs.existsSync(path.join(mindPath, '.github', 'skills'))).toBe(true);
    expect(fs.existsSync(path.join(mindPath, '.working-memory', 'memory.md'))).toBe(true);
    expect(fs.existsSync(path.join(mindPath, '.working-memory', 'rules.md'))).toBe(true);
    expect(fs.existsSync(path.join(mindPath, '.working-memory', 'log.md'))).toBe(true);
  });

  it('lets DailyLogWriter append a structured frame without producing log.legacy.md', async () => {
    const callLog: RegistryCallLog = { fetchTree: [], fetchBlob: [], fetchJsonContent: [] };
    const scaffold = new MindScaffold(
      makeFakeRegistryClient(callLog),
      makeFakeClientFactory(defaultSeedFiles),
    );

    const mindPath = await scaffold.create({
      name: 'Writer Mind',
      role: 'integration tester',
      voice: 'plain',
      voiceDescription: 'plain',
      basePath: tmpRoot,
    });

    const writer = createDailyLogWriter({ mindId: 'writer-mind', mindPath });
    const turn: CompletedTurn = {
      turnId: '00000000-0000-4000-8000-000000000001',
      sessionId: 'sess-int-1',
      model: 'claude-opus-4.7',
      status: 'completed',
      startedAt: '2026-05-13T14:00:00Z',
      endedAt: '2026-05-13T14:00:05Z',
      prompt: 'hello',
      finalAssistantMessage: 'hi back',
    };
    await writer.write(turn);

    const logContent = fs.readFileSync(
      path.join(mindPath, '.working-memory', 'log.md'),
      'utf-8',
    );
    expect(logContent).toContain(STRUCTURED_LOG_SENTINEL);
    expect(logContent).toContain('turn:00000000-0000-4000-8000-000000000001');
    expect(logContent).toContain('### user');
    expect(logContent).toContain('### assistant');
    // The sentinel pre-seed means no rotation happens — log.legacy.md must not exist.
    expect(fs.existsSync(path.join(mindPath, '.working-memory', 'log.legacy.md'))).toBe(false);
  });

  it('WorkingMemoryComposer treats the fresh mind as structured (no info or warn fired)', async () => {
    const callLog: RegistryCallLog = { fetchTree: [], fetchBlob: [], fetchJsonContent: [] };
    const scaffold = new MindScaffold(
      makeFakeRegistryClient(callLog),
      makeFakeClientFactory(defaultSeedFiles),
    );

    const mindPath = await scaffold.create({
      name: 'Composer Mind',
      role: 'integration tester',
      voice: 'plain',
      voiceDescription: 'plain',
      basePath: tmpRoot,
    });

    const warn = vi.fn();
    const info = vi.fn();
    const composer = createWorkingMemoryComposer({ logger: { warn, info } });
    composer.compose(mindPath, { enabled: true, lastKTurns: 10, perTurnMaxBytes: 2048, memoryMaxBytes: 8192 });

    expect(warn).not.toHaveBeenCalled();
    // info may be called for benign reasons (e.g. memory.md truncation) but
    // must NEVER be called with the "unstructured" message for a fresh mind.
    for (const call of info.mock.calls) {
      expect(call[0]).not.toMatch(/unstructured/i);
    }
  });

  // Cross-cutting migration story for minds that already exist on disk in the
  // pre-fix shape: an unstructured `log.md` (no sentinel). Locks in three
  // promises end-to-end:
  //   1. Composer reads the unstructured file at `info` level — never `warn`
  //      (the migration-window contract).
  //   2. DailyLogWriter on the first chat turn rotates the legacy content out
  //      to `log.legacy.md` and seeds a fresh sentinel-prefixed log.md.
  //   3. After rotation, the composer is silent (no further unstructured
  //      messages on subsequent prompt rebuilds).
  it('migrates an existing pre-fix mind: composer info → first turn rotates → composer silent', async () => {
    const callLog: RegistryCallLog = { fetchTree: [], fetchBlob: [], fetchJsonContent: [] };
    const scaffold = new MindScaffold(
      makeFakeRegistryClient(callLog),
      makeFakeClientFactory(defaultSeedFiles),
    );

    const mindPath = await scaffold.create({
      name: 'Legacy Mind',
      role: 'integration tester',
      voice: 'plain',
      voiceDescription: 'plain',
      basePath: tmpRoot,
    });

    // Simulate a mind that was scaffolded BEFORE the fix shipped: unstructured
    // log.md with no sentinel. This is the on-disk shape for every existing
    // user upgrading into this release.
    const logPath = path.join(mindPath, '.working-memory', 'log.md');
    const legacyPath = path.join(mindPath, '.working-memory', 'log.legacy.md');
    const legacyContent = '# pre-fix freeform notes\n\nthis is what existing minds have.\n';
    fs.writeFileSync(logPath, legacyContent);
    expect(fs.existsSync(legacyPath)).toBe(false);

    const warn = vi.fn();
    const info = vi.fn();
    const composer = createWorkingMemoryComposer({ logger: { warn, info } });

    // Step 1: opening the mind triggers a system-prompt rebuild → info, never warn.
    composer.compose(mindPath, { enabled: true, lastKTurns: 10, perTurnMaxBytes: 2048, memoryMaxBytes: 8192 });
    expect(warn).not.toHaveBeenCalled();
    const unstructuredInfoCalls = info.mock.calls.filter((c) => /unstructured/i.test(c[0]));
    expect(unstructuredInfoCalls.length).toBe(1);

    // Step 2: first chat turn → DailyLogWriter rotates and seeds the sentinel.
    const writer = createDailyLogWriter({ mindId: 'legacy-mind', mindPath });
    const turn: CompletedTurn = {
      turnId: '00000000-0000-4000-8000-000000000099',
      sessionId: 'sess-legacy-1',
      model: 'claude-opus-4.7',
      status: 'completed',
      startedAt: '2026-05-13T15:00:00Z',
      endedAt: '2026-05-13T15:00:05Z',
      prompt: 'first turn after upgrade',
      finalAssistantMessage: 'welcome back',
    };
    await writer.write(turn);

    expect(fs.existsSync(legacyPath)).toBe(true);
    expect(fs.readFileSync(legacyPath, 'utf-8')).toBe(legacyContent);
    const rotatedLog = fs.readFileSync(logPath, 'utf-8');
    expect(rotatedLog).toContain(STRUCTURED_LOG_SENTINEL);
    expect(rotatedLog).toContain('turn:00000000-0000-4000-8000-000000000099');

    // Step 3: subsequent prompt rebuild is silent — migration is complete.
    info.mockClear();
    warn.mockClear();
    composer.compose(mindPath, { enabled: true, lastKTurns: 10, perTurnMaxBytes: 2048, memoryMaxBytes: 8192 });
    expect(warn).not.toHaveBeenCalled();
    for (const call of info.mock.calls) {
      expect(call[0]).not.toMatch(/unstructured/i);
    }
  });
});
