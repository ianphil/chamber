/**
 * Phase 14 — Dream Daemon end-to-end integration.
 *
 * Builds the full per-mind consolidation graph against a real on-disk
 * mind directory and a real better-sqlite3 dream.db, then drives a
 * 7-day simulated run with a deterministic in-test LLM client. The
 * test substitutes the LLM client (the only seam that would otherwise
 * require Electron / network) — every other collaborator is the real
 * production implementation.
 *
 * Properties verified (matches the Phase 14 deliverables in plan.md):
 *
 *   1. memory.md exists at the end and stays under `memoryMaxBytes` (8192).
 *   2. weekly/<YYYY-WNN>.md rollup is materialised after 7 daily ticks.
 *   3. log.md is pruned (sentinel preserved + only post-cutoff turns survive).
 *   4. archive/consolidated/ accumulates one file per source turn.
 *   5. Re-running the daemon when no new turns have arrived is skipped
 *      with a non-success result (no double-processing).
 *   6. Two parallel `daemon.run()` calls produce exactly one cycle —
 *      the second one short-circuits with a `locked` skip.
 *   7. dream_state.last_consolidated_turn_id advances monotonically.
 *   8. A turn appended between snapshot and prune survives in log.md.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

import {
  createMindMemoryService,
  createInternalScheduler,
  createMindMemoryVault,
  createMindArchiveStore,
  createDreamDaemon,
  defaultConfigReader,
  migrate as migrateDreamDb,
  readState,
  listRuns,
  type DaemonFactoryOptions,
  type DreamDaemon,
  type DreamDaemonConfig,
  type LLMClient,
  type SynthesizeRequest,
  type MindMemoryService,
  type ChatObserverRegistry,
} from '@chamber/services';
import type { TurnCompletionObserver, CompletedTurn } from '@chamber/shared';

const runtimeRequire = createRequire(__filename);

// ---------------------------------------------------------------------------
// Test-local LLM client
// ---------------------------------------------------------------------------

/**
 * In-test LLMClient. The default response is the canonical daily-log
 * vault delta `extractFromLog` accepts (header `## HH:MM:SS`, content
 * lines `**[type]** body`). `pauseNext()` lets a single test arrange
 * for the LLM call to suspend so a turn can be appended mid-cycle.
 */
interface TestLLMController {
  readonly client: LLMClient;
  readonly calls: SynthesizeRequest[];
  pauseNext(): () => void;
}

function makeTestLLMController(canned: string): TestLLMController {
  const calls: SynthesizeRequest[] = [];
  let pendingPause: { release: () => void; promise: Promise<void> } | null = null;

  const client: LLMClient = {
    async synthesize(req: SynthesizeRequest): Promise<string> {
      calls.push(req);
      if (pendingPause) {
        const p = pendingPause;
        pendingPause = null;
        await p.promise;
      }
      return canned;
    },
  };

  return {
    client,
    calls,
    pauseNext(): () => void {
      let release: () => void = () => {
        /* placeholder */
      };
      const promise = new Promise<void>((res) => {
        release = res;
      });
      pendingPause = { release, promise };
      return release;
    },
  };
}

const CANNED_VAULT_DELTA = [
  '## 12:00:00',
  '**[user-prompt]** I prefer kebab-case file names.',
  '**[user-prompt]** Always follow TDD when implementing features.',
  '**[user-prompt]** Never skip required testing steps before claiming done.',
  '',
].join('\n');

// ---------------------------------------------------------------------------
// Fakes (only ChatService — everything else is real)
// ---------------------------------------------------------------------------

function makeChatRegistry(): ChatObserverRegistry & {
  readonly observers: TurnCompletionObserver[];
} {
  const observers: TurnCompletionObserver[] = [];
  return {
    addObserver(o: TurnCompletionObserver): void {
      observers.push(o);
    },
    removeObserver(o: TurnCompletionObserver): void {
      const i = observers.indexOf(o);
      if (i !== -1) observers.splice(i, 1);
    },
    get observers() {
      return observers;
    },
  };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const MIND_ID = 'mind-integration';

interface Harness {
  readonly mindRoot: string;
  readonly mindPath: string;
  readonly service: MindMemoryService;
  readonly scheduler: ReturnType<typeof createInternalScheduler>;
  readonly chat: ReturnType<typeof makeChatRegistry>;
  readonly llm: TestLLMController;
  readonly openDbs: import('better-sqlite3').Database[];
  daemon(): DreamDaemon;
  db(): import('better-sqlite3').Database;
  cleanup(): Promise<void>;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const INTEGRATION_CONFIG: DreamDaemonConfig = {
  memoryMaxBytes: 8192,
  llmTimeoutMs: 60_000,
  lockTtlMs: 300_000,
  minTurnsBetweenRuns: 1,
  minDailyIntervalMs: 0,
  weeklyRollupAfterDailies: 7,
  monthlyRollupAfterWeeklies: 4,
  weeklyMinIntervalMs: 7 * MS_PER_DAY,
  monthlyMinIntervalMs: 30 * MS_PER_DAY,
};

function writeChamberConfig(mindPath: string): void {
  const cfg = {
    workingMemory: {
      consolidation: {
        enabled: true,
        cron: '0 3 * * *',
        lastKTurns: 10,
        perTurnMaxBytes: 2048,
        memoryMaxBytes: 8192,
      },
    },
  };
  writeFileSync(path.join(mindPath, '.chamber.json'), JSON.stringify(cfg, null, 2), 'utf-8');
}

function buildHarness(): Harness {
  const mindRoot = mkdtempSync(path.join(tmpdir(), 'chamber-mindmem-int-'));
  const mindPath = path.join(mindRoot, MIND_ID);
  mkdirSync(mindPath, { recursive: true });
  writeChamberConfig(mindPath);

  const scheduler = createInternalScheduler();
  const chat = makeChatRegistry();
  const llm = makeTestLLMController(CANNED_VAULT_DELTA);
  const openDbs: import('better-sqlite3').Database[] = [];
  const Database = runtimeRequire('better-sqlite3') as typeof import('better-sqlite3');

  let capturedDaemon: DreamDaemon | null = null;
  let capturedDb: import('better-sqlite3').Database | null = null;

  const service = createMindMemoryService({
    scheduler,
    chatService: chat,
    configReader: defaultConfigReader,
    dbFactory: (dbPath: string) => {
      mkdirSync(path.dirname(dbPath), { recursive: true });
      const db = new Database(dbPath);
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');
      migrateDreamDb(db);
      openDbs.push(db);
      capturedDb = db;
      return db;
    },
    vaultFactory: createMindMemoryVault,
    archiveFactory: createMindArchiveStore,
    daemonFactory: (opts: DaemonFactoryOptions) => {
      // Real daemon, real vault/archive/db — only the LLM is substituted.
      const daemon = createDreamDaemon({
        mindId: opts.mindId,
        mindPath: opts.mindPath,
        vault: opts.vault,
        archiveStore: opts.archive,
        db: opts.db,
        llmClient: llm.client,
        config: INTEGRATION_CONFIG,
      });
      capturedDaemon = daemon;
      return daemon;
    },
  });

  return {
    mindRoot,
    mindPath,
    service,
    scheduler,
    chat,
    llm,
    openDbs,
    daemon(): DreamDaemon {
      if (!capturedDaemon) throw new Error('daemon not yet constructed (call activateMind first)');
      return capturedDaemon;
    },
    db(): import('better-sqlite3').Database {
      if (!capturedDb) throw new Error('db not yet opened (call activateMind first)');
      return capturedDb;
    },
    async cleanup() {
      try {
        await service.close();
      } catch {
        /* noop */
      }
      try {
        scheduler.close();
      } catch {
        /* noop */
      }
      for (const db of openDbs) {
        try {
          if (db.open) db.close();
        } catch {
          /* noop */
        }
      }
      rmSync(mindRoot, { recursive: true, force: true });
    },
  };
}

function makeTurn(
  dayIndex: number,
  withinDay: number,
  prompt: string,
  assistant: string,
): CompletedTurn {
  const turnId = `t-d${String(dayIndex).padStart(2, '0')}-${String(withinDay).padStart(2, '0')}`;
  const startedAt = new Date(Date.now()).toISOString();
  return {
    turnId,
    sessionId: `s-day-${dayIndex}`,
    model: 'gpt-test',
    status: 'completed',
    startedAt,
    endedAt: startedAt,
    prompt,
    finalAssistantMessage: assistant,
  };
}

const DAILY_PROMPTS: ReadonlyArray<readonly [string, string]> = [
  ['I prefer kebab-case file names.', 'Got it — I will use kebab-case.'],
  ['Always follow TDD when implementing features.', 'Acknowledged — TDD by default.'],
  ['Never skip required testing steps before claiming done.', 'Understood.'],
  ['Use Tailwind for styling.', 'OK — Tailwind it is.'],
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Dream Daemon — multi-day integration', () => {
  let harness: Harness | null = null;

  beforeEach(() => {
    harness = null;
  });

  afterEach(async () => {
    if (harness) {
      await harness.cleanup();
      harness = null;
    }
  });

  it('consolidates 7 simulated days end-to-end with bounded memory.md, weekly rollup, pruned log, and monotonic state', async () => {
    harness = buildHarness();
    await harness.service.activateMind(MIND_ID, harness.mindPath);

    const observer = harness.chat.observers[0];
    expect(observer).toBeDefined();
    const db = harness.db();

    let prevLastTurnId: string | null = null;
    const lastTurnIdsByDay: string[] = [];

    // Simulate 7 days. Each day: append several turns, then trigger one
    // consolidation cycle via the scheduler entry (the same fn croner
    // would invoke at 03:00).
    for (let day = 1; day <= 7; day++) {
      for (let i = 0; i < DAILY_PROMPTS.length; i++) {
        const [p, a] = DAILY_PROMPTS[i]!;
        await observer!.onTurnCompleted(makeTurn(day, i, p, a));
      }

      // Activity counter must have advanced (proves the onTurnRecorded
      // hook is wired into DailyLogWriter).
      expect(readState(db).turnsSinceLastRun).toBe(DAILY_PROMPTS.length);

      await harness.scheduler.runNow(MIND_ID);

      const state = readState(db);
      expect(state.lastConsolidatedTurnId).not.toBeNull();
      lastTurnIdsByDay.push(state.lastConsolidatedTurnId!);

      if (prevLastTurnId !== null) {
        // Monotonic advance: the new id must be a turn from this day.
        expect(state.lastConsolidatedTurnId!.startsWith(`t-d${String(day).padStart(2, '0')}-`)).toBe(true);
      }
      prevLastTurnId = state.lastConsolidatedTurnId;

      // Activity counter is reset after each successful run.
      expect(readState(db).turnsSinceLastRun).toBe(0);
    }

    // -- Property 1: memory.md exists and is bounded -----------------
    const memoryPath = path.join(harness.mindPath, '.working-memory', 'memory.md');
    expect(existsSync(memoryPath)).toBe(true);
    const memoryBuf = readFileSync(memoryPath);
    expect(memoryBuf.byteLength).toBeGreaterThan(0);
    expect(memoryBuf.byteLength).toBeLessThanOrEqual(INTEGRATION_CONFIG.memoryMaxBytes);
    const memoryText = memoryBuf.toString('utf-8');
    // Curated content from the canned vault delta should be visible.
    expect(memoryText.toLowerCase()).toContain('kebab-case');

    // -- Property 2: weekly rollup materialised ----------------------
    const weeklyDir = path.join(harness.mindPath, '.working-memory', 'archive', 'weekly');
    expect(existsSync(weeklyDir)).toBe(true);
    const weeklyFiles = await readdir(weeklyDir);
    expect(weeklyFiles.length).toBeGreaterThanOrEqual(1);
    expect(weeklyFiles.some((f) => /^\d{4}-W\d{2}\.md$/.test(f))).toBe(true);

    // -- Property 3: log.md is pruned (sentinel preserved) -----------
    const logPath = path.join(harness.mindPath, '.working-memory', 'log.md');
    expect(existsSync(logPath)).toBe(true);
    const logText = readFileSync(logPath, 'utf-8');
    expect(logText).toContain('chamber-structured-log/v1');
    // After the final cycle, no in-scope turn ids remain (everything
    // already archived). Survivors would be turns appended *after* the
    // last snapshot — none in this test, so no `turn:t-dXX-YY` headers.
    expect(/turn:t-d\d{2}-\d{2}/.test(logText)).toBe(false);

    // -- Property 4: archive/consolidated/ accumulates ---------------
    const consolidatedDir = path.join(harness.mindPath, '.working-memory', 'archive', 'consolidated');
    expect(existsSync(consolidatedDir)).toBe(true);
    const consolidatedFiles = await readdir(consolidatedDir);
    expect(consolidatedFiles.length).toBe(7 * DAILY_PROMPTS.length);

    // -- Property 5: re-run with no new turns is skipped --------------
    const llmCallsBefore = harness.llm.calls.length;
    await harness.scheduler.runNow(MIND_ID);
    expect(harness.llm.calls.length).toBe(llmCallsBefore); // synthesize NOT invoked
    const stateAfterIdleRun = readState(db);
    expect(stateAfterIdleRun.lastConsolidatedTurnId).toBe(prevLastTurnId);

    // -- Property 7: monotonic last_consolidated_turn_id --------------
    for (let i = 1; i < lastTurnIdsByDay.length; i++) {
      // Day-prefixed ids — newer-day prefix lexicographically greater.
      expect(lastTurnIdsByDay[i]!.localeCompare(lastTurnIdsByDay[i - 1]!)).toBeGreaterThan(0);
    }

    // -- Run history shows the success cycles plus the trailing skip --
    const runs = listRuns(db, { limit: 100 });
    const successes = runs.filter((r) => r.status === 'success');
    expect(successes.length).toBe(7);
  });

  it('parallel daemon.run() calls — only one cycle executes; the loser short-circuits with a skip', async () => {
    harness = buildHarness();
    await harness.service.activateMind(MIND_ID, harness.mindPath);

    const observer = harness.chat.observers[0]!;
    await observer.onTurnCompleted(makeTurn(1, 1, 'I prefer kebab-case file names.', 'ok'));

    const release = harness.llm.pauseNext();

    const daemon = harness.daemon();
    const a = daemon.run();
    // Yield once so the first run() acquires the in-process mutex / DB lock.
    await Promise.resolve();
    await Promise.resolve();
    const b = daemon.run();

    // Release the LLM call so the first run can complete.
    release();

    const [ra, rb] = await Promise.all([a, b]);
    const outcomes = [ra.status, rb.status].sort();
    // Exactly one success, one skip.
    expect(outcomes).toEqual(['skipped', 'success']);

    // Synthesize was called exactly once across both runs.
    expect(harness.llm.calls.length).toBe(1);
  });

  it('a turn appended between snapshot and prune survives in log.md', async () => {
    harness = buildHarness();
    await harness.service.activateMind(MIND_ID, harness.mindPath);

    const observer = harness.chat.observers[0]!;
    // Pre-cycle turns.
    await observer.onTurnCompleted(makeTurn(1, 1, 'I prefer kebab-case file names.', 'ok'));
    await observer.onTurnCompleted(makeTurn(1, 2, 'Always follow TDD when implementing features.', 'ok'));

    const release = harness.llm.pauseNext();
    const daemon = harness.daemon();

    const runPromise = daemon.run();

    // Wait until synthesize has been called — that proves snapshot has
    // already been taken (snapshot precedes synthesize in runCycleLocked).
    while (harness.llm.calls.length === 0) {
      await new Promise((r) => setImmediate(r));
    }

    // Append a tail turn AFTER snapshot but BEFORE prune.
    const tail = makeTurn(1, 9, 'tail prompt that arrives mid-cycle', 'tail assistant');
    await observer.onTurnCompleted(tail);

    release();
    const result = await runPromise;
    expect(result.status).toBe('success');

    // The tail turn must still be in log.md (not archived, not pruned).
    const logPath = path.join(harness.mindPath, '.working-memory', 'log.md');
    const logText = readFileSync(logPath, 'utf-8');
    expect(logText).toContain('chamber-structured-log/v1');
    expect(logText).toContain(tail.turnId);

    // And it should NOT have been archived (only snapshot turns are).
    const consolidatedDir = path.join(harness.mindPath, '.working-memory', 'archive', 'consolidated');
    const consolidatedFiles = await readdir(consolidatedDir);
    expect(consolidatedFiles.length).toBe(2);
    expect(consolidatedFiles.some((f) => f.includes(tail.turnId))).toBe(false);
  });
});
