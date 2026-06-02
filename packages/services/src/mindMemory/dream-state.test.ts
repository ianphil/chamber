/**
 * Tests for dream-state — typed CRUD over the dream-schema tables, plus
 * lock acquire/release with stale-lock break.
 *
 * Phase 7 acceptance:
 *   - readState round-trips through writes; defaults when row missing.
 *   - incrementTurnCount accumulates atomically.
 *   - markPhaseComplete updates only the targeted phase.
 *   - setLastConsolidatedTurnId round-trips through null.
 *   - recordRun appends to dream_runs and listRuns reads back.
 *   - acquireLock/releaseLock honor the lock holder format and stale-break.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import Database from 'better-sqlite3';

import { migrate } from './dream-schema';
import {
  acquireLock,
  buildLockHolder,
  getLock,
  incrementTurnCount,
  listRuns,
  markPhaseComplete,
  readState,
  recordRun,
  releaseLock,
  resetActivityCounter,
  setLastConsolidatedTurnId,
} from './dream-state';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  migrate(db);
});

afterEach(() => {
  db.close();
});

describe('dream-state — readState defaults', () => {
  it('returns the singleton defaults after migrate', () => {
    const s = readState(db);
    expect(s.turnsSinceLastRun).toBe(0);
    expect(s.lastDailyAt).toBeNull();
    expect(s.lastWeeklyAt).toBeNull();
    expect(s.lastMonthlyAt).toBeNull();
    expect(s.lastConsolidatedTurnId).toBeNull();
  });

  it('returns sensible defaults if the singleton row was deleted', () => {
    db.prepare('DELETE FROM dream_state WHERE id = 1').run();
    const s = readState(db);
    expect(s.turnsSinceLastRun).toBe(0);
    expect(s.lastDailyAt).toBeNull();
    expect(s.lastConsolidatedTurnId).toBeNull();
  });
});

describe('dream-state — incrementTurnCount', () => {
  it('increments by 1 by default', () => {
    incrementTurnCount(db);
    incrementTurnCount(db);
    expect(readState(db).turnsSinceLastRun).toBe(2);
  });

  it('increments by n', () => {
    incrementTurnCount(db, 5);
    expect(readState(db).turnsSinceLastRun).toBe(5);
  });

  it('rejects non-positive n', () => {
    expect(() => incrementTurnCount(db, 0)).toThrow();
    expect(() => incrementTurnCount(db, -1)).toThrow();
  });
});

describe('dream-state — resetActivityCounter', () => {
  it('zeroes turns_since_last_run', () => {
    incrementTurnCount(db, 7);
    resetActivityCounter(db);
    expect(readState(db).turnsSinceLastRun).toBe(0);
  });
});

describe('dream-state — markPhaseComplete', () => {
  it('updates only the targeted phase timestamp', () => {
    markPhaseComplete(db, 'daily', 1000);
    let s = readState(db);
    expect(s.lastDailyAt).toBe(1000);
    expect(s.lastWeeklyAt).toBeNull();
    expect(s.lastMonthlyAt).toBeNull();

    markPhaseComplete(db, 'weekly', 2000);
    s = readState(db);
    expect(s.lastDailyAt).toBe(1000);
    expect(s.lastWeeklyAt).toBe(2000);
    expect(s.lastMonthlyAt).toBeNull();

    markPhaseComplete(db, 'monthly', 3000);
    s = readState(db);
    expect(s.lastMonthlyAt).toBe(3000);
  });
});

describe('dream-state — setLastConsolidatedTurnId', () => {
  it('round-trips through a non-null id', () => {
    setLastConsolidatedTurnId(db, 'turn-alpha');
    expect(readState(db).lastConsolidatedTurnId).toBe('turn-alpha');
  });

  it('round-trips through null', () => {
    setLastConsolidatedTurnId(db, 'turn-alpha');
    setLastConsolidatedTurnId(db, null);
    expect(readState(db).lastConsolidatedTurnId).toBeNull();
  });
});

describe('dream-state — recordRun + listRuns', () => {
  it('appends in chronological order; listRuns returns most-recent-first', () => {
    recordRun(db, {
      phase: 'daily',
      startedAt: 100,
      endedAt: 200,
      status: 'success',
      fromTurnId: 'turn-1',
      toTurnId: 'turn-3',
    });
    recordRun(db, {
      phase: 'daily',
      startedAt: 300,
      endedAt: null,
      status: 'skipped',
      reason: 'no-activity',
    });

    const runs = listRuns(db);
    expect(runs).toHaveLength(2);
    expect(runs[0].startedAt).toBe(300);
    expect(runs[0].status).toBe('skipped');
    expect(runs[0].reason).toBe('no-activity');
    expect(runs[1].fromTurnId).toBe('turn-1');
    expect(runs[1].toTurnId).toBe('turn-3');
  });

  it('listRuns honors phase filter and limit', () => {
    recordRun(db, { phase: 'daily', startedAt: 1, endedAt: 2, status: 'success' });
    recordRun(db, { phase: 'weekly', startedAt: 3, endedAt: 4, status: 'success' });
    recordRun(db, { phase: 'daily', startedAt: 5, endedAt: 6, status: 'success' });

    const daily = listRuns(db, { phase: 'daily' });
    expect(daily.map((r) => r.startedAt)).toEqual([5, 1]);

    const limited = listRuns(db, { limit: 1 });
    expect(limited).toHaveLength(1);
    expect(limited[0].startedAt).toBe(5);
  });
});

describe('dream-state — buildLockHolder', () => {
  it('produces the dream-daemon:<mindId>:<pid>:<uuid> shape', () => {
    const holder = buildLockHolder('mind-x', 1234, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(holder).toBe('dream-daemon:mind-x:1234:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  });

  it('defaults pid to process.pid and uuid to a random uuid v4-ish string', () => {
    const holder = buildLockHolder('mind-y');
    expect(holder.startsWith(`dream-daemon:mind-y:${process.pid}:`)).toBe(true);
    const uuid = holder.split(':').pop()!;
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });
});

describe('dream-state — acquireLock / releaseLock', () => {
  it('first acquire succeeds with reason=acquired', () => {
    const r = acquireLock(db, { phase: 'daily', mindId: 'm', now: 1000, ttlMs: 5000 });
    expect(r.acquired).toBe(true);
    expect(r.reason).toBe('acquired');
    expect(r.holder).toMatch(/^dream-daemon:m:/);

    const row = getLock(db, 'daily')!;
    expect(row.phase).toBe('daily');
    expect(row.acquiredAt).toBe(1000);
    expect(row.expiresAt).toBe(6000);
  });

  it('second acquire while still held returns reason=held with the existing holder', () => {
    const a = acquireLock(db, { phase: 'daily', mindId: 'm', now: 1000, ttlMs: 5000 });
    const b = acquireLock(db, { phase: 'daily', mindId: 'm', now: 1500, ttlMs: 5000 });
    expect(a.acquired).toBe(true);
    expect(b.acquired).toBe(false);
    expect(b.reason).toBe('held');
    expect(b.holder).toBe(a.holder);
  });

  it('stale lock (expires_at < now) is stolen with reason=stolen-stale', () => {
    const first = acquireLock(db, { phase: 'daily', mindId: 'm', now: 1000, ttlMs: 1000 });
    expect(first.acquired).toBe(true);
    // jump past expiry
    const second = acquireLock(db, { phase: 'daily', mindId: 'm', now: 5000, ttlMs: 1000 });
    expect(second.acquired).toBe(true);
    expect(second.reason).toBe('stolen-stale');
    expect(second.holder).not.toBe(first.holder);

    const row = getLock(db, 'daily')!;
    expect(row.holder).toBe(second.holder);
    expect(row.acquiredAt).toBe(5000);
  });

  it('only one of two concurrent steal attempts succeeds (transactional re-check)', () => {
    // Plant a stale lock
    db.prepare(
      'INSERT INTO dream_locks (phase, holder, acquired_at, expires_at) VALUES (?, ?, ?, ?)',
    ).run('daily', 'dream-daemon:m:1:old-uuid', 0, 1);

    // Two distinct callers try to steal at the same `now`
    const a = acquireLock(db, { phase: 'daily', mindId: 'm', uuid: 'a', now: 1000, ttlMs: 1000 });
    const b = acquireLock(db, { phase: 'daily', mindId: 'm', uuid: 'b', now: 1000, ttlMs: 1000 });

    // The first call performs the steal; the second sees a's lock and reports held.
    expect(a.acquired).toBe(true);
    expect(a.reason).toBe('stolen-stale');
    expect(b.acquired).toBe(false);
    expect(b.reason).toBe('held');
    expect(b.holder).toBe(a.holder);
  });

  it('releaseLock only removes the row when the holder matches', () => {
    const a = acquireLock(db, { phase: 'daily', mindId: 'm', now: 1000, ttlMs: 5000 });
    const released = releaseLock(db, 'daily', 'dream-daemon:m:0:wrong');
    expect(released).toBe(false);
    expect(getLock(db, 'daily')).not.toBeNull();

    const ok = releaseLock(db, 'daily', a.holder!);
    expect(ok).toBe(true);
    expect(getLock(db, 'daily')).toBeNull();
  });

  it('after release, a fresh acquire succeeds with reason=acquired', () => {
    const a = acquireLock(db, { phase: 'daily', mindId: 'm', now: 1000, ttlMs: 5000 });
    releaseLock(db, 'daily', a.holder!);
    const c = acquireLock(db, { phase: 'daily', mindId: 'm', now: 2000, ttlMs: 5000 });
    expect(c.acquired).toBe(true);
    expect(c.reason).toBe('acquired');
  });
});
