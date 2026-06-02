/**
 * Tests for consolidation-scheduler — cron evaluation, per-mind in-memory
 * mutex (try-lock), and tick orchestration that combines cron, gates, DB
 * lock, and run/persist.
 *
 * Phase 7 acceptance:
 *   - evaluateCron answers due/not-due against a controlled clock.
 *   - withMindMutex serializes per mind; concurrent acquires fail-fast.
 *   - tick() respects gates, DB lock, and the mutex.
 *   - tick() records run history on success and skips with a reason on
 *     each gate failure path.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Database from 'better-sqlite3';

import { migrate } from './dream-schema';
import {
  acquireLock,
  buildLockHolder,
  getLock,
  incrementTurnCount,
  listRuns,
  readState,
} from './dream-state';
import {
  __resetMindMutexForTesting,
  createConsolidationScheduler,
  evaluateCron,
  withMindMutex,
} from './consolidation-scheduler';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  migrate(db);
  __resetMindMutexForTesting();
});

afterEach(() => {
  db.close();
});

describe('consolidation-scheduler — evaluateCron', () => {
  it('reports due when nextRun(lastFireAt) <= now', () => {
    // Daily at 03:00 UTC.
    const last = new Date('2026-05-12T00:00:00Z');
    const now = new Date('2026-05-12T03:00:01Z');
    const r = evaluateCron('0 3 * * *', last, now, { timezone: 'UTC' });
    expect(r.due).toBe(true);
    expect(r.nextDueAt!.toISOString()).toBe('2026-05-12T03:00:00.000Z');
  });

  it('reports not-due when nextRun is in the future', () => {
    const last = new Date('2026-05-12T03:00:00Z');
    const now = new Date('2026-05-12T04:00:00Z');
    const r = evaluateCron('0 3 * * *', last, now, { timezone: 'UTC' });
    expect(r.due).toBe(false);
    expect(r.nextDueAt!.toISOString()).toBe('2026-05-13T03:00:00.000Z');
  });

  it('treats lastFireAt=null as the unix epoch (always-due on first tick)', () => {
    const r = evaluateCron('0 3 * * *', null, new Date('2026-05-12T03:00:01Z'), { timezone: 'UTC' });
    expect(r.due).toBe(true);
  });
});

describe('consolidation-scheduler — withMindMutex (try-lock)', () => {
  it('serializes runs for the same mindId; second concurrent caller fails fast', async () => {
    let release!: () => void;
    const blocker = new Promise<void>((r) => {
      release = r;
    });

    const a = withMindMutex('mind-x', async () => {
      await blocker;
      return 'a-done';
    });
    const b = withMindMutex('mind-x', async () => 'b-done');

    await expect(b).resolves.toEqual({ acquired: false, reason: 'locked' });
    release();
    await expect(a).resolves.toEqual({ acquired: true, value: 'a-done' });
  });

  it('different mindIds do not block each other', async () => {
    let release!: () => void;
    const blocker = new Promise<void>((r) => {
      release = r;
    });

    const a = withMindMutex('mind-a', async () => {
      await blocker;
      return 'a';
    });
    const b = withMindMutex('mind-b', async () => 'b');

    await expect(b).resolves.toEqual({ acquired: true, value: 'b' });
    release();
    await expect(a).resolves.toEqual({ acquired: true, value: 'a' });
  });

  it('releases the slot after rejection so the next call may proceed', async () => {
    const first = withMindMutex('mind-x', async () => {
      throw new Error('boom');
    });
    await expect(first).rejects.toThrow(/boom/);

    const second = withMindMutex('mind-x', async () => 'ok');
    await expect(second).resolves.toEqual({ acquired: true, value: 'ok' });
  });
});

describe('consolidation-scheduler — tick', () => {
  function buildScheduler(opts: {
    now: number;
    runDaily?: () => Promise<void>;
    cron?: string;
    minTurnsBetweenRuns?: number;
    minIntervalMs?: number;
    lockTtlMs?: number;
  }) {
    let current = opts.now;
    const clock = () => new Date(current);
    const setNow = (n: number) => {
      current = n;
    };

    const sched = createConsolidationScheduler({
      mindId: 'mind-x',
      db,
      cronExpr: opts.cron ?? '* * * * *', // every minute by default
      gateConfig: {
        minTurnsBetweenRuns: opts.minTurnsBetweenRuns ?? 1,
        minIntervalMs: opts.minIntervalMs ?? 0,
      },
      lockTtlMs: opts.lockTtlMs ?? 60_000,
      clock,
      runDaily:
        opts.runDaily ??
        (async () => {
          /* no-op */
        }),
      timezone: 'UTC',
    });

    return { sched, setNow };
  }

  it('runs daily, records the run, marks phase complete, and resets activity', async () => {
    incrementTurnCount(db, 3);
    const { sched } = buildScheduler({ now: 1_700_000_000_000 });

    const r = await sched.tick();
    expect(r.run).toBe(true);
    expect(r.reason).toBe('ready');
    expect(r.phase).toBe('daily');

    const state = readState(db);
    expect(state.turnsSinceLastRun).toBe(0);
    expect(state.lastDailyAt).toBe(1_700_000_000_000);

    const runs = listRuns(db);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('success');
    expect(runs[0].phase).toBe('daily');

    expect(getLock(db, 'daily')).toBeNull();
  });

  it('skips with reason=no-activity when activity gate fails (no run recorded as success)', async () => {
    const { sched } = buildScheduler({ now: 1_700_000_000_000, minTurnsBetweenRuns: 5 });
    const r = await sched.tick();
    expect(r.run).toBe(false);
    expect(r.reason).toBe('no-activity');

    const runs = listRuns(db);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('skipped');
    expect(runs[0].reason).toBe('no-activity');
  });

  it('skips with reason=cron-not-due when cron has not yet matched', async () => {
    incrementTurnCount(db, 1);
    // Cron at 03:00 UTC every day; current time is 02:00 UTC and lastDailyAt
    // is "today at 03:00", so nextRun(03:00) is tomorrow at 03:00 → not due.
    const today03 = new Date('2026-05-12T03:00:00Z').getTime();
    const today02 = new Date('2026-05-12T02:00:00Z').getTime();
    db.prepare('UPDATE dream_state SET last_daily_at = ? WHERE id = 1').run(today03);

    const { sched } = buildScheduler({
      now: today02 + 24 * 60 * 60 * 1000, // jump a day forward but before next 03:00
      cron: '0 3 * * *',
    });
    // Adjust: now = 2026-05-13T02:00:00Z, last = 2026-05-12T03:00:00Z,
    // nextRun(last) = 2026-05-13T03:00:00Z → still > now, not due.
    const r = await sched.tick();
    expect(r.run).toBe(false);
    expect(r.reason).toBe('cron-not-due');
  });

  it('returns reason=locked when the in-memory mutex is held by a concurrent tick', async () => {
    incrementTurnCount(db, 3);

    let release!: () => void;
    const blocker = new Promise<void>((r) => {
      release = r;
    });

    const { sched } = buildScheduler({
      now: 1_700_000_000_000,
      runDaily: async () => {
        await blocker;
      },
    });

    const first = sched.tick();
    const second = await sched.tick();

    expect(second.run).toBe(false);
    expect(second.reason).toBe('locked');

    release();
    const r1 = await first;
    expect(r1.run).toBe(true);
  });

  it('returns reason=db-locked when another process holds a fresh DB lock', async () => {
    incrementTurnCount(db, 3);
    // Simulate another process holding the lock with plenty of TTL left.
    acquireLock(db, {
      phase: 'daily',
      mindId: 'someone-else',
      now: 1_700_000_000_000,
      ttlMs: 60_000,
    });

    const { sched } = buildScheduler({ now: 1_700_000_000_000 });
    const r = await sched.tick();
    expect(r.run).toBe(false);
    expect(r.reason).toBe('db-locked');

    // Skipped run must be recorded.
    const runs = listRuns(db);
    expect(runs.some((x) => x.status === 'skipped' && x.reason === 'db-locked')).toBe(true);
  });

  it('breaks a stale DB lock and proceeds', async () => {
    incrementTurnCount(db, 3);
    db.prepare(
      'INSERT INTO dream_locks (phase, holder, acquired_at, expires_at) VALUES (?, ?, ?, ?)',
    ).run('daily', buildLockHolder('ghost', 1, 'old'), 0, 1);

    const { sched } = buildScheduler({ now: 1_700_000_000_000 });
    const r = await sched.tick();
    expect(r.run).toBe(true);
    expect(r.reason).toBe('ready');
  });

  it('records a failed run when runDaily throws and releases the lock', async () => {
    incrementTurnCount(db, 3);
    const failing = vi.fn(async () => {
      throw new Error('synthetic consolidator failure');
    });

    const { sched } = buildScheduler({ now: 1_700_000_000_000, runDaily: failing });

    await expect(sched.tick()).rejects.toThrow(/synthetic consolidator failure/);

    expect(failing).toHaveBeenCalledTimes(1);
    const runs = listRuns(db);
    expect(runs[0].status).toBe('failed');
    expect(getLock(db, 'daily')).toBeNull();
    // Activity counter is NOT reset on failure (the consolidator did not run
    // to completion).
    expect(readState(db).turnsSinceLastRun).toBe(3);
  });

  it('getNextDueAt projects from lastDailyAt', () => {
    db.prepare('UPDATE dream_state SET last_daily_at = ? WHERE id = 1').run(
      new Date('2026-05-12T03:00:00Z').getTime(),
    );
    const { sched } = buildScheduler({ now: Date.UTC(2026, 4, 12, 3, 0, 0), cron: '0 3 * * *' });
    const next = sched.getNextDueAt();
    expect(next!.toISOString()).toBe('2026-05-13T03:00:00.000Z');
  });
});
