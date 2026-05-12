/**
 * Tests for DreamDaemon — Phase 9 orchestrator.
 *
 * Covers the full cycle (gates → lock → snapshot → extract via LLM →
 * consolidate → write memory.md → prune log.md preserving tail → archive →
 * tiered rollups → record run → release lock) plus the negative paths
 * (gate skip, lock skip, force bypass, mid-run append survival, LLM
 * failure, idempotent close).
 *
 * Fakes / fixtures:
 *   - in-memory better-sqlite3 (`:memory:`) + `migrate(db)` from Phase 7
 *   - real tmp-dir vault + archive (Phase 3 modules)
 *   - `createFakeLLMClient` from Phase 8 `__fakes__`
 *   - injected clock for deterministic tiered-rollup gates
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import Database from 'better-sqlite3';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { migrate } from './dream-schema';
import {
  acquireLock,
  getLock,
  incrementTurnCount,
  listRuns,
  markPhaseComplete,
  readState,
  setLastConsolidatedTurnId,
} from './dream-state';
import { createMindMemoryVault } from './MindMemoryVault';
import { createMindArchiveStore } from './MindArchiveStore';
import { STRUCTURED_LOG_SENTINEL, serializeTurn } from './StructuredLogFormat';
import type { CompletedTurn } from '@chamber/shared/turn-observer';
import { createFakeLLMClient, type FakeLLMClient } from './__fakes__/FakeLLMClient';
import {
  __resetMindMutexForTesting,
} from './consolidation-scheduler';
import {
  createDreamDaemon,
  type DreamDaemon,
  type DreamDaemonConfig,
  type DreamRunResult,
} from './DreamDaemon';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

const MIND_ID = 'test-mind';
const FROZEN_NOW_MS = Date.parse('2026-05-12T15:00:00Z');

let mindRoot: string;
let db: Database.Database;
let llmClient: FakeLLMClient;
let now: number;

const baseConfig: DreamDaemonConfig = {
  memoryMaxBytes: 8192,
  llmTimeoutMs: 60_000,
  lockTtlMs: 300_000,
  minTurnsBetweenRuns: 1,
  minDailyIntervalMs: 0, // disabled by default; tests opt in by overriding
  weeklyRollupAfterDailies: 7,
  monthlyRollupAfterWeeklies: 4,
  weeklyMinIntervalMs: MS_PER_WEEK,
  monthlyMinIntervalMs: 30 * MS_PER_DAY,
};

beforeEach(() => {
  mindRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-daemon-'));
  db = new Database(':memory:');
  migrate(db);
  llmClient = createFakeLLMClient({
    defaultResponse:
      '## 12:00:00\n**[user-prompt]** I prefer kebab-case file names.\n',
  });
  now = FROZEN_NOW_MS;
  __resetMindMutexForTesting();
});

afterEach(() => {
  db.close();
  fs.rmSync(mindRoot, { recursive: true, force: true });
  __resetMindMutexForTesting();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clock(): Date {
  return new Date(now);
}

function makeTurn(overrides: Partial<CompletedTurn> = {}): CompletedTurn {
  const turnId = overrides.turnId ?? `turn-${Math.random().toString(36).slice(2, 10)}`;
  const ts = overrides.endedAt ?? new Date(now).toISOString();
  return {
    turnId,
    sessionId: overrides.sessionId ?? 'session-1',
    model: overrides.model ?? 'gpt-test',
    status: overrides.status ?? 'completed',
    startedAt: overrides.startedAt ?? ts,
    endedAt: ts,
    prompt: overrides.prompt ?? `prompt for ${turnId}`,
    finalAssistantMessage:
      overrides.finalAssistantMessage ?? `assistant for ${turnId}`,
  };
}

async function seedLog(turns: CompletedTurn[]): Promise<void> {
  await fsp.mkdir(path.join(mindRoot, '.working-memory'), { recursive: true });
  const body = `${STRUCTURED_LOG_SENTINEL}\n\n${turns.map(serializeTurn).join('')}`;
  await fsp.writeFile(path.join(mindRoot, '.working-memory', 'log.md'), body);
}

async function readLog(): Promise<string> {
  return fsp.readFile(path.join(mindRoot, '.working-memory', 'log.md'), 'utf-8');
}

function makeDaemon(configOverrides: Partial<DreamDaemonConfig> = {}): DreamDaemon {
  const vault = createMindMemoryVault(mindRoot);
  const archiveStore = createMindArchiveStore(mindRoot);
  return createDreamDaemon({
    mindId: MIND_ID,
    mindPath: mindRoot,
    llmClient,
    vault,
    archiveStore,
    db,
    config: { ...baseConfig, ...configOverrides },
    clock,
  });
}

function isoOf(ms: number): string {
  return new Date(ms).toISOString();
}

async function waitForRelease(
  getRelease: () => (() => void) | null,
  timeoutMs = 2000,
): Promise<() => void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = getRelease();
    if (r !== null) return r;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('timed out waiting for LLM synthesize to be invoked');
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

describe('DreamDaemon — public surface', () => {
  it('exposes run, forceRun, getStatus, notifyTurnCompleted, close', () => {
    const daemon = makeDaemon();
    expect(typeof daemon.run).toBe('function');
    expect(typeof daemon.forceRun).toBe('function');
    expect(typeof daemon.getStatus).toBe('function');
    expect(typeof daemon.notifyTurnCompleted).toBe('function');
    expect(typeof daemon.close).toBe('function');
  });

  it('initial getStatus reports phase=idle, locked=false, lastRunAt=null', () => {
    const daemon = makeDaemon();
    const s = daemon.getStatus();
    expect(s.phase).toBe('idle');
    expect(s.locked).toBe(false);
    expect(s.lastRunAt).toBeNull();
    expect(s.lastResult).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('DreamDaemon — happy path cycle', () => {
  it('runs end-to-end: writes memory.md, prunes log.md, archives, records run, advances cutoff', async () => {
    const t1 = makeTurn({ turnId: 'turn-A' });
    const t2 = makeTurn({ turnId: 'turn-B' });
    await seedLog([t1, t2]);
    incrementTurnCount(db, 2);

    const daemon = makeDaemon();
    const result = await daemon.run();

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.fromTurnId).toBeNull();
    expect(result.toTurnId).toBe('turn-B');
    expect(result.consolidatedCount).toBeGreaterThan(0);
    expect(result.archivedCount).toBe(2);

    // memory.md exists and is non-empty
    const memoryMd = await fsp.readFile(
      path.join(mindRoot, '.working-memory', 'memory.md'),
      'utf-8',
    );
    expect(memoryMd.length).toBeGreaterThan(0);
    expect(memoryMd).toMatch(/kebab-case/i);

    // log.md retains sentinel; both consolidated turns are pruned
    const log = await readLog();
    expect(log.startsWith(STRUCTURED_LOG_SENTINEL)).toBe(true);
    expect(log).not.toContain('turn-A');
    expect(log).not.toContain('turn-B');

    // archive/consolidated/ has 2 files
    const archiveDir = path.join(mindRoot, '.working-memory', 'archive', 'consolidated');
    const files = await fsp.readdir(archiveDir);
    expect(files).toHaveLength(2);

    // state advanced
    const state = readState(db);
    expect(state.lastConsolidatedTurnId).toBe('turn-B');
    expect(state.turnsSinceLastRun).toBe(0);
    expect(state.lastDailyAt).not.toBeNull();

    // dream_runs has a success row
    const runs = listRuns(db, { phase: 'daily' });
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe('success');
    expect(runs[0]!.toTurnId).toBe('turn-B');

    // lock released
    expect(getLock(db, 'daily')).toBeNull();
    const status = daemon.getStatus();
    expect(status.locked).toBe(false);
    expect(status.phase).toBe('idle');
    expect(status.lastRunAt).toBe(now);
  });

  it('only consolidates turns AFTER lastConsolidatedTurnId', async () => {
    const t1 = makeTurn({ turnId: 'turn-old' });
    const t2 = makeTurn({ turnId: 'turn-new' });
    await seedLog([t1, t2]);
    setLastConsolidatedTurnId(db, 'turn-old');
    incrementTurnCount(db, 1);

    const daemon = makeDaemon();
    const result = await daemon.run();

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.fromTurnId).toBe('turn-old');
    expect(result.toTurnId).toBe('turn-new');
    expect(result.archivedCount).toBe(1);

    const archiveFiles = await fsp.readdir(
      path.join(mindRoot, '.working-memory', 'archive', 'consolidated'),
    );
    expect(archiveFiles).toHaveLength(1);
    expect(archiveFiles[0]).toContain('turn-new');
  });

  it('returns skipped/no-turns when log.md has no turns past the cutoff', async () => {
    const t1 = makeTurn({ turnId: 'turn-already-consolidated' });
    await seedLog([t1]);
    setLastConsolidatedTurnId(db, 'turn-already-consolidated');
    incrementTurnCount(db, 1);

    const daemon = makeDaemon();
    const result = await daemon.run();
    expect(result).toEqual({ status: 'skipped', reason: 'no-turns' });

    expect(llmClient.calls).toHaveLength(0);
    expect(getLock(db, 'daily')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Gate / lock skip
// ---------------------------------------------------------------------------

describe('DreamDaemon — gate skip', () => {
  it('returns skipped/no-activity when activity counter is below threshold', async () => {
    await seedLog([makeTurn({ turnId: 'turn-1' })]);
    // turnsSinceLastRun stays at 0
    const daemon = makeDaemon();
    const result = await daemon.run();
    expect(result).toEqual({ status: 'skipped', reason: 'no-activity' });
    expect(llmClient.calls).toHaveLength(0);
    expect(getLock(db, 'daily')).toBeNull();
    // state untouched
    expect(readState(db).lastConsolidatedTurnId).toBeNull();
  });

  it('returns skipped/too-soon when last daily run was within minDailyIntervalMs', async () => {
    await seedLog([makeTurn({ turnId: 'turn-1' })]);
    incrementTurnCount(db, 1);
    markPhaseComplete(db, 'daily', now - 1000);

    const daemon = makeDaemon({ minDailyIntervalMs: MS_PER_DAY });
    const result = await daemon.run();
    expect(result).toEqual({ status: 'skipped', reason: 'too-soon' });
    expect(llmClient.calls).toHaveLength(0);
  });
});

describe('DreamDaemon — lock skip', () => {
  it('returns skipped/locked when another holder owns the daily lock', async () => {
    await seedLog([makeTurn({ turnId: 'turn-1' })]);
    incrementTurnCount(db, 1);

    acquireLock(db, {
      phase: 'daily',
      mindId: 'other-process',
      now,
      ttlMs: 60_000,
    });

    const daemon = makeDaemon();
    const result = await daemon.run();
    expect(result).toEqual({ status: 'skipped', reason: 'locked' });
    expect(llmClient.calls).toHaveLength(0);

    // The daemon must NOT have stolen / released the held lock
    const lock = getLock(db, 'daily');
    expect(lock).not.toBeNull();
    expect(lock!.holder).not.toMatch(new RegExp(`:${MIND_ID}:`));
  });

  it('concurrent forceRun calls: second call returns locked while first is in flight', async () => {
    await seedLog([makeTurn({ turnId: 'turn-1' })]);

    let releaseLLM: (() => void) | null = null;
    llmClient = {
      calls: [],
      synthesize: (req) => {
        (llmClient.calls as unknown as typeof llmClient.calls[number][]).push(req);
        return new Promise<string>((resolve) => {
          releaseLLM = () =>
            resolve('## 12:00:00\n**[user-prompt]** I prefer kebab-case.\n');
        });
      },
    } as FakeLLMClient;

    const daemon = makeDaemon();
    const first = daemon.forceRun();
    // Wait until the first call actually enters synthesize.
    const release = await waitForRelease(() => releaseLLM);

    const second = await daemon.forceRun();
    expect(second).toEqual({ status: 'skipped', reason: 'locked' });

    release();
    const firstResult = await first;
    expect(firstResult.status).toBe('success');
  });
});

// ---------------------------------------------------------------------------
// forceRun
// ---------------------------------------------------------------------------

describe('DreamDaemon — forceRun', () => {
  it('bypasses the activity gate', async () => {
    await seedLog([makeTurn({ turnId: 'turn-1' })]);
    // turnsSinceLastRun = 0 → would be no-activity for run()

    const daemon = makeDaemon();
    const result = await daemon.forceRun();
    expect(result.status).toBe('success');
  });

  it('bypasses the time gate', async () => {
    await seedLog([makeTurn({ turnId: 'turn-1' })]);
    markPhaseComplete(db, 'daily', now - 1000);

    const daemon = makeDaemon({ minDailyIntervalMs: MS_PER_DAY });
    const result = await daemon.forceRun();
    expect(result.status).toBe('success');
  });

  it('still respects an externally held lock', async () => {
    await seedLog([makeTurn({ turnId: 'turn-1' })]);
    acquireLock(db, {
      phase: 'daily',
      mindId: 'other-process',
      now,
      ttlMs: 60_000,
    });
    const daemon = makeDaemon();
    const result = await daemon.forceRun();
    expect(result).toEqual({ status: 'skipped', reason: 'locked' });
  });
});

// ---------------------------------------------------------------------------
// Mid-run append
// ---------------------------------------------------------------------------

describe('DreamDaemon — mid-run append', () => {
  it('preserves a turn appended to log.md AFTER the snapshot is taken', async () => {
    const t1 = makeTurn({ turnId: 'turn-pre' });
    await seedLog([t1]);
    incrementTurnCount(db, 1);

    let releaseLLM: (() => void) | null = null;
    llmClient = {
      calls: [] as unknown as FakeLLMClient['calls'],
      synthesize: (req) => {
        (llmClient.calls as unknown as typeof llmClient.calls[number][]).push(req);
        return new Promise<string>((resolve) => {
          releaseLLM = () =>
            resolve(
              '## 12:00:00\n**[user-prompt]** I prefer kebab-case.\n',
            );
        });
      },
    } as FakeLLMClient;

    const daemon = makeDaemon();
    const runPromise = daemon.run();

    // Wait until the daemon actually enters the synthesize await.
    const release = await waitForRelease(() => releaseLLM);

    // Append a new frame to log.md while the LLM call is paused.
    const tail = makeTurn({ turnId: 'turn-tail', endedAt: isoOf(now + 1000) });
    await fsp.appendFile(
      path.join(mindRoot, '.working-memory', 'log.md'),
      serializeTurn(tail),
    );

    release();
    const result = await runPromise;
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;

    // turn-pre was consolidated and pruned; turn-tail must remain.
    const log = await readLog();
    expect(log).toContain('turn-tail');
    expect(log).not.toContain('turn-pre');

    // cutoff advanced only to turn-pre, NOT past the tail entry.
    expect(result.toTurnId).toBe('turn-pre');
    expect(readState(db).lastConsolidatedTurnId).toBe('turn-pre');
  });
});

// ---------------------------------------------------------------------------
// LLM failures
// ---------------------------------------------------------------------------

describe('DreamDaemon — error handling', () => {
  it('LLM error: returns failed result, releases lock, leaves state untouched', async () => {
    await seedLog([makeTurn({ turnId: 'turn-1' })]);
    incrementTurnCount(db, 1);

    llmClient = createFakeLLMClient({ error: new Error('boom') });
    const daemon = makeDaemon();

    const result = await daemon.run();
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toContain('boom');
    }

    // State did NOT advance; cutoff still null
    const state = readState(db);
    expect(state.lastConsolidatedTurnId).toBeNull();
    expect(state.turnsSinceLastRun).toBe(1); // not reset on failure

    // Lock was released
    expect(getLock(db, 'daily')).toBeNull();

    // memory.md was NOT written
    expect(
      fs.existsSync(path.join(mindRoot, '.working-memory', 'memory.md')),
    ).toBe(false);

    // log.md was NOT pruned
    const log = await readLog();
    expect(log).toContain('turn-1');

    // dream_runs has a failed row
    const runs = listRuns(db, { phase: 'daily' });
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe('failed');
  });

  it('LLM timeout: returns failed result with timeout reason, releases lock', async () => {
    await seedLog([makeTurn({ turnId: 'turn-1' })]);
    incrementTurnCount(db, 1);

    llmClient = createFakeLLMClient({ latencyMs: 1000 });
    const daemon = makeDaemon({ llmTimeoutMs: 5 });
    const result = await daemon.run();
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toMatch(/timed out/i);
    }
    expect(getLock(db, 'daily')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tiered rollups
// ---------------------------------------------------------------------------

describe('DreamDaemon — tiered weekly rollup', () => {
  async function preSeedDailyArchives(count: number): Promise<void> {
    const archive = createMindArchiveStore(mindRoot);
    for (let i = 0; i < count; i++) {
      await archive.writeConsolidated({
        turnId: `seed-${i}`,
        timestamp: isoOf(now - (count - i) * 60_000),
        content: `seed body ${i} I prefer kebab-case file names.`,
      });
    }
  }

  it('triggers when daily-archive count meets threshold and weekly is due', async () => {
    await preSeedDailyArchives(7);
    await seedLog([makeTurn({ turnId: 'turn-1' })]);
    incrementTurnCount(db, 1);
    // lastWeeklyAt unset → due
    const daemon = makeDaemon();
    const result = await daemon.run();
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.weeklyArchived).toBe(true);

    const weeklyDir = path.join(mindRoot, '.working-memory', 'archive', 'weekly');
    const weeklyFiles = await fsp.readdir(weeklyDir);
    expect(weeklyFiles.length).toBeGreaterThan(0);

    expect(readState(db).lastWeeklyAt).not.toBeNull();
  });

  it('does NOT trigger when fewer than threshold daily archives exist', async () => {
    await preSeedDailyArchives(3);
    await seedLog([makeTurn({ turnId: 'turn-1' })]);
    incrementTurnCount(db, 1);

    const daemon = makeDaemon();
    const result = await daemon.run();
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.weeklyArchived).toBe(false);

    const weeklyDir = path.join(mindRoot, '.working-memory', 'archive', 'weekly');
    expect(fs.existsSync(weeklyDir)).toBe(false);
    expect(readState(db).lastWeeklyAt).toBeNull();
  });

  it('does NOT trigger when weekly was already done within weeklyMinIntervalMs', async () => {
    await preSeedDailyArchives(7);
    await seedLog([makeTurn({ turnId: 'turn-1' })]);
    incrementTurnCount(db, 1);
    markPhaseComplete(db, 'weekly', now - 1000);

    const daemon = makeDaemon();
    const result = await daemon.run();
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.weeklyArchived).toBe(false);
  });
});

describe('DreamDaemon — tiered monthly rollup', () => {
  async function preSeedDailyArchives(count: number): Promise<void> {
    const archive = createMindArchiveStore(mindRoot);
    for (let i = 0; i < count; i++) {
      await archive.writeConsolidated({
        turnId: `seed-${i}`,
        timestamp: isoOf(now - (count - i) * 60_000),
        content: `seed body ${i} I prefer kebab-case.`,
      });
    }
  }

  async function preSeedWeeklyArchives(count: number): Promise<void> {
    const archive = createMindArchiveStore(mindRoot);
    for (let i = 0; i < count; i++) {
      await archive.writeWeekly(
        `2026-W0${i + 1}`,
        `weekly summary ${i} I prefer kebab-case.`,
      );
    }
  }

  it('triggers when weekly-archive count meets threshold and monthly is due', async () => {
    await preSeedDailyArchives(7);
    await preSeedWeeklyArchives(4);
    await seedLog([makeTurn({ turnId: 'turn-1' })]);
    incrementTurnCount(db, 1);

    const daemon = makeDaemon();
    const result = await daemon.run();
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.monthlyArchived).toBe(true);

    const monthlyDir = path.join(mindRoot, '.working-memory', 'archive', 'monthly');
    const monthlyFiles = await fsp.readdir(monthlyDir);
    expect(monthlyFiles.length).toBeGreaterThan(0);
    expect(readState(db).lastMonthlyAt).not.toBeNull();
  });

  it('does NOT trigger when fewer than threshold weeklies exist', async () => {
    await preSeedWeeklyArchives(2);
    await seedLog([makeTurn({ turnId: 'turn-1' })]);
    incrementTurnCount(db, 1);

    const daemon = makeDaemon();
    const result = await daemon.run();
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.monthlyArchived).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// notifyTurnCompleted + close
// ---------------------------------------------------------------------------

describe('DreamDaemon — notifyTurnCompleted', () => {
  it('is a no-op (does not throw, does not mutate state)', () => {
    const daemon = makeDaemon();
    const before = readState(db);
    daemon.notifyTurnCompleted(makeTurn({ turnId: 'turn-noop' }));
    const after = readState(db);
    expect(after).toEqual(before);
  });
});

describe('DreamDaemon — close', () => {
  it('is idempotent and rejects subsequent run() calls', async () => {
    const daemon = makeDaemon();
    await daemon.close();
    await daemon.close();

    const result = await daemon.run();
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toMatch(/closed/i);
    }
  });
});

// ---------------------------------------------------------------------------
// Status reflects current phase
// ---------------------------------------------------------------------------

describe('DreamDaemon — getStatus mid-run', () => {
  it('reports locked=true while a run is in progress', async () => {
    await seedLog([makeTurn({ turnId: 'turn-1' })]);
    incrementTurnCount(db, 1);

    let releaseLLM: (() => void) | null = null;
    llmClient = {
      calls: [] as unknown as FakeLLMClient['calls'],
      synthesize: (req) => {
        (llmClient.calls as unknown as typeof llmClient.calls[number][]).push(req);
        return new Promise<string>((resolve) => {
          releaseLLM = () =>
            resolve('## 12:00:00\n**[user-prompt]** I prefer kebab-case.\n');
        });
      },
    } as FakeLLMClient;

    const daemon = makeDaemon();
    const runPromise = daemon.run();
    const release = await waitForRelease(() => releaseLLM);

    const midStatus = daemon.getStatus();
    expect(midStatus.locked).toBe(true);
    expect(midStatus.phase).not.toBe('idle');

    release();
    const result = await runPromise;
    expect(result.status).toBe('success');

    const finalStatus = daemon.getStatus();
    expect(finalStatus.locked).toBe(false);
    expect(finalStatus.phase).toBe('idle');
    expect(finalStatus.lastResult).toEqual(result as DreamRunResult);
  });
});
