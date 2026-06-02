/**
 * consolidation-scheduler — composes croner-based cron evaluation, the
 * per-mind in-memory mutex, the DB lock, and the activity/time gates into
 * a single `tick()` orchestration.
 *
 * Three layers of mutual exclusion:
 *
 *   1. Per-mind in-memory mutex (try-lock). Defeats same-process races
 *      where two `tick()` calls land in the JS event loop before the DB
 *      lock row is written. Implemented as `Map<mindId, Promise>` with
 *      fail-fast semantics — the second concurrent caller returns
 *      `{ acquired: false, reason: 'locked' }` instead of queuing.
 *
 *   2. DB lock row in `dream_locks`. Defeats cross-process races. Honors
 *      a configurable TTL so a crashed daemon cannot wedge the mind
 *      forever — see `dream-state.acquireLock`.
 *
 *   3. Combined activity + time gate (`dream-gates.evaluateGates`). The
 *      cron expression is treated as a coarse "is it the configured wake
 *      time yet?" filter on top of the time gate.
 *
 * Phase 7 ships only the daily phase; weekly/monthly land in Phase 9.
 *
 * `evaluateCron` is exported separately so the scheduler can be stubbed
 * in higher-level tests without dragging in croner.
 */

import { Cron } from 'croner';
import type Database from 'better-sqlite3';

import { Logger } from '../logger';
import { evaluateGates, type GateConfig } from './dream-gates';
import {
  acquireLock,
  buildLockHolder,
  getLock,
  markPhaseComplete,
  readState,
  recordRun,
  releaseLock,
} from './dream-state';

export interface CronEvaluation {
  readonly due: boolean;
  readonly nextDueAt: Date | null;
}

export function evaluateCron(
  cronExpr: string,
  lastFireAt: Date | null,
  now: Date,
  opts: { timezone?: string } = {},
): CronEvaluation {
  // `paused: true` disables the croner background timer — we only use the
  // expression evaluator.
  const job = new Cron(cronExpr, { paused: true, timezone: opts.timezone });
  try {
    const seed = lastFireAt ?? new Date(0);
    const next = job.nextRun(seed);
    if (!next) return { due: false, nextDueAt: null };
    return { due: next.getTime() <= now.getTime(), nextDueAt: next };
  } finally {
    job.stop();
  }
}

// ---------------------------------------------------------------------------
// Per-mind in-memory mutex (try-lock)
// ---------------------------------------------------------------------------

const mindMutex = new Map<string, Promise<unknown>>();

export type WithMindMutexResult<T> =
  | { readonly acquired: true; readonly value: T }
  | { readonly acquired: false; readonly reason: 'locked' };

export async function withMindMutex<T>(
  mindId: string,
  fn: () => Promise<T>,
): Promise<WithMindMutexResult<T>> {
  if (mindMutex.has(mindId)) {
    return { acquired: false, reason: 'locked' };
  }
  const promise = (async () => fn())();
  mindMutex.set(
    mindId,
    promise.then(
      () => undefined,
      () => undefined,
    ),
  );
  try {
    const value = await promise;
    return { acquired: true, value };
  } finally {
    mindMutex.delete(mindId);
  }
}

/** Test-only helper to drop in-memory state between tests. */
export function __resetMindMutexForTesting(): void {
  mindMutex.clear();
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

export interface RunContext {
  readonly mindId: string;
  readonly startedAt: number;
}

export interface SchedulerOptions {
  readonly mindId: string;
  readonly db: Database.Database;
  readonly cronExpr: string;
  readonly gateConfig: GateConfig;
  readonly lockTtlMs: number;
  readonly clock: () => Date;
  readonly runDaily: (ctx: RunContext) => Promise<void>;
  readonly timezone?: string;
}

export type TickReason =
  | 'ready'
  | 'locked'
  | 'db-locked'
  | 'no-activity'
  | 'too-soon'
  | 'cron-not-due';

export interface TickResult {
  readonly run: boolean;
  readonly reason: TickReason;
  readonly phase?: 'daily';
}

export interface ConsolidationScheduler {
  tick(): Promise<TickResult>;
  getNextDueAt(): Date | null;
}

export function createConsolidationScheduler(opts: SchedulerOptions): ConsolidationScheduler {
  const log = Logger.create('ConsolidationScheduler');

  function projectNextDue(): Date | null {
    const state = readState(opts.db);
    const last = state.lastDailyAt !== null ? new Date(state.lastDailyAt) : null;
    return evaluateCron(opts.cronExpr, last, opts.clock(), { timezone: opts.timezone }).nextDueAt;
  }

  async function runOnceLocked(): Promise<TickResult> {
    const startedAtDate = opts.clock();
    const now = startedAtDate.getTime();

    const state = readState(opts.db);
    const lockRow = getLock(opts.db, 'daily');
    const lockHeldByOther = lockRow !== null && lockRow.expiresAt > now;

    // Cron evaluation — the configured wake time must have passed since
    // the last successful daily run.
    const cron = evaluateCron(
      opts.cronExpr,
      state.lastDailyAt !== null ? new Date(state.lastDailyAt) : null,
      startedAtDate,
      { timezone: opts.timezone },
    );
    if (!cron.due) {
      recordRun(opts.db, {
        phase: 'daily',
        startedAt: now,
        endedAt: now,
        status: 'skipped',
        reason: 'cron-not-due',
      });
      return { run: false, reason: 'cron-not-due', phase: 'daily' };
    }

    // Activity + time gate (lockHeld surfaced for completeness, but
    // db-locked is reported separately below for clearer triage).
    const gate = evaluateGates(
      { phase: 'daily', state, now, lockHeld: lockHeldByOther },
      opts.gateConfig,
    );
    if (!gate.run) {
      const reason: TickReason = gate.reason === 'locked' ? 'db-locked' : gate.reason;
      recordRun(opts.db, {
        phase: 'daily',
        startedAt: now,
        endedAt: now,
        status: 'skipped',
        reason,
      });
      return { run: false, reason, phase: 'daily' };
    }

    // Try to acquire the DB lock (with stale-break).
    const lock = acquireLock(opts.db, {
      phase: 'daily',
      mindId: opts.mindId,
      now,
      ttlMs: opts.lockTtlMs,
    });
    if (!lock.acquired) {
      recordRun(opts.db, {
        phase: 'daily',
        startedAt: now,
        endedAt: now,
        status: 'skipped',
        reason: 'db-locked',
      });
      return { run: false, reason: 'db-locked', phase: 'daily' };
    }

    const holder = lock.holder ?? buildLockHolder(opts.mindId);
    try {
      await opts.runDaily({ mindId: opts.mindId, startedAt: now });
      const endedAt = opts.clock().getTime();

      // Persist success: timestamp + reset activity + run history.
      // Activity reset is intentional only on success — a failed run
      // leaves the counter intact so the next tick will retry.
      opts.db.transaction(() => {
        opts.db.prepare('UPDATE dream_state SET turns_since_last_run = 0, last_daily_at = ? WHERE id = 1').run(endedAt);
      })();
      // markPhaseComplete is functionally equivalent for daily but kept
      // for symmetry with future weekly/monthly callers.
      markPhaseComplete(opts.db, 'daily', endedAt);
      recordRun(opts.db, {
        phase: 'daily',
        startedAt: now,
        endedAt,
        status: 'success',
        reason: 'ready',
      });
      return { run: true, reason: 'ready', phase: 'daily' };
    } catch (err) {
      const endedAt = opts.clock().getTime();
      const message = err instanceof Error ? err.message : String(err);
      recordRun(opts.db, {
        phase: 'daily',
        startedAt: now,
        endedAt,
        status: 'failed',
        reason: message,
      });
      log.warn(`daily consolidation failed for mind ${opts.mindId}: ${message}`);
      throw err;
    } finally {
      releaseLock(opts.db, 'daily', holder);
    }
  }

  return {
    async tick(): Promise<TickResult> {
      const outcome = await withMindMutex(opts.mindId, () => runOnceLocked());
      if (!outcome.acquired) {
        return { run: false, reason: 'locked', phase: 'daily' };
      }
      return outcome.value;
    },
    getNextDueAt(): Date | null {
      return projectNextDue();
    },
  };
}
