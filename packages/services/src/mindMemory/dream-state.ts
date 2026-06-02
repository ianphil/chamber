/**
 * dream-state — typed CRUD over the dream-schema tables, plus DB-backed
 * lock acquire/release with stale-lock break.
 *
 * All writes are wrapped in `db.transaction(...)` so a partial failure
 * cannot leave the singleton row half-updated. Lock steal is implemented
 * inside a single transaction that re-checks `expires_at` so two
 * simultaneous stealers cannot both succeed.
 *
 * Lock holder format: `dream-daemon:<mindId>:<pid>:<uuid>` — the uuid
 * component defeats same-process re-acquisition by a stale handle. The
 * in-memory mutex layered on top lives in consolidation-scheduler.ts.
 */

import { randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';

import type { DreamPhase, DreamRunStatus } from './dream-schema';

export interface DreamState {
  readonly turnsSinceLastRun: number;
  readonly lastDailyAt: number | null;
  readonly lastWeeklyAt: number | null;
  readonly lastMonthlyAt: number | null;
  readonly lastConsolidatedTurnId: string | null;
}

export interface RunRecord {
  readonly phase: DreamPhase;
  readonly startedAt: number;
  readonly endedAt: number | null;
  readonly status: DreamRunStatus;
  readonly reason?: string | null;
  readonly fromTurnId?: string | null;
  readonly toTurnId?: string | null;
}

export interface DreamLockRow {
  readonly phase: DreamPhase;
  readonly holder: string;
  readonly acquiredAt: number;
  readonly expiresAt: number;
}

export interface AcquireLockArgs {
  readonly phase: DreamPhase;
  readonly mindId: string;
  readonly pid?: number;
  readonly uuid?: string;
  readonly now: number;
  readonly ttlMs: number;
}

export type AcquireLockReason = 'acquired' | 'stolen-stale' | 'held';

export interface AcquireLockResult {
  readonly acquired: boolean;
  readonly holder: string | null;
  readonly reason: AcquireLockReason;
}

export interface ListRunsOptions {
  readonly phase?: DreamPhase;
  readonly limit?: number;
}

const DEFAULT_STATE: DreamState = {
  turnsSinceLastRun: 0,
  lastDailyAt: null,
  lastWeeklyAt: null,
  lastMonthlyAt: null,
  lastConsolidatedTurnId: null,
};

const PHASE_COLUMN: Record<DreamPhase, 'last_daily_at' | 'last_weekly_at' | 'last_monthly_at'> = {
  daily: 'last_daily_at',
  weekly: 'last_weekly_at',
  monthly: 'last_monthly_at',
};

interface DreamStateRow {
  turns_since_last_run: number;
  last_daily_at: number | null;
  last_weekly_at: number | null;
  last_monthly_at: number | null;
  last_consolidated_turn_id: string | null;
}

export function readState(db: Database.Database): DreamState {
  const row = db
    .prepare(
      `SELECT turns_since_last_run, last_daily_at, last_weekly_at, last_monthly_at, last_consolidated_turn_id
       FROM dream_state WHERE id = 1`,
    )
    .get() as DreamStateRow | undefined;

  if (!row) return DEFAULT_STATE;

  return {
    turnsSinceLastRun: row.turns_since_last_run,
    lastDailyAt: row.last_daily_at,
    lastWeeklyAt: row.last_weekly_at,
    lastMonthlyAt: row.last_monthly_at,
    lastConsolidatedTurnId: row.last_consolidated_turn_id,
  };
}

export function incrementTurnCount(db: Database.Database, n = 1): void {
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`incrementTurnCount: n must be a positive integer (got ${n})`);
  }
  db.transaction(() => {
    db.prepare('INSERT OR IGNORE INTO dream_state (id) VALUES (1)').run();
    db.prepare('UPDATE dream_state SET turns_since_last_run = turns_since_last_run + ? WHERE id = 1').run(n);
  })();
}

export function resetActivityCounter(db: Database.Database): void {
  db.transaction(() => {
    db.prepare('INSERT OR IGNORE INTO dream_state (id) VALUES (1)').run();
    db.prepare('UPDATE dream_state SET turns_since_last_run = 0 WHERE id = 1').run();
  })();
}

export function markPhaseComplete(db: Database.Database, phase: DreamPhase, ts: number): void {
  const col = PHASE_COLUMN[phase];
  db.transaction(() => {
    db.prepare('INSERT OR IGNORE INTO dream_state (id) VALUES (1)').run();
    db.prepare(`UPDATE dream_state SET ${col} = ? WHERE id = 1`).run(ts);
  })();
}

export function setLastConsolidatedTurnId(db: Database.Database, turnId: string | null): void {
  db.transaction(() => {
    db.prepare('INSERT OR IGNORE INTO dream_state (id) VALUES (1)').run();
    db.prepare('UPDATE dream_state SET last_consolidated_turn_id = ? WHERE id = 1').run(turnId);
  })();
}

export function recordRun(db: Database.Database, record: RunRecord): number {
  const info = db
    .prepare(
      `INSERT INTO dream_runs (phase, started_at, ended_at, status, reason, from_turn_id, to_turn_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      record.phase,
      record.startedAt,
      record.endedAt,
      record.status,
      record.reason ?? null,
      record.fromTurnId ?? null,
      record.toTurnId ?? null,
    );
  return Number(info.lastInsertRowid);
}

interface DreamRunRow {
  phase: DreamPhase;
  started_at: number;
  ended_at: number | null;
  status: DreamRunStatus;
  reason: string | null;
  from_turn_id: string | null;
  to_turn_id: string | null;
}

export function listRuns(db: Database.Database, opts: ListRunsOptions = {}): RunRecord[] {
  const where = opts.phase ? 'WHERE phase = ?' : '';
  const limitClause = opts.limit ? `LIMIT ${Math.max(1, Math.floor(opts.limit))}` : '';
  const sql = `SELECT phase, started_at, ended_at, status, reason, from_turn_id, to_turn_id
               FROM dream_runs ${where}
               ORDER BY started_at DESC, id DESC ${limitClause}`;
  const stmt = db.prepare(sql);
  const rows = (opts.phase ? stmt.all(opts.phase) : stmt.all()) as DreamRunRow[];
  return rows.map((r) => ({
    phase: r.phase,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    status: r.status,
    reason: r.reason,
    fromTurnId: r.from_turn_id,
    toTurnId: r.to_turn_id,
  }));
}

export function buildLockHolder(mindId: string, pid: number = process.pid, uuid: string = randomUUID()): string {
  return `dream-daemon:${mindId}:${pid}:${uuid}`;
}

interface LockRowRaw {
  phase: DreamPhase;
  holder: string;
  acquired_at: number;
  expires_at: number;
}

export function getLock(db: Database.Database, phase: DreamPhase): DreamLockRow | null {
  const row = db
    .prepare('SELECT phase, holder, acquired_at, expires_at FROM dream_locks WHERE phase = ?')
    .get(phase) as LockRowRaw | undefined;
  if (!row) return null;
  return {
    phase: row.phase,
    holder: row.holder,
    acquiredAt: row.acquired_at,
    expiresAt: row.expires_at,
  };
}

export function acquireLock(db: Database.Database, args: AcquireLockArgs): AcquireLockResult {
  const holder = buildLockHolder(args.mindId, args.pid, args.uuid);
  const expiresAt = args.now + args.ttlMs;

  // The whole acquire is a single transaction: SELECT-then-write under
  // BEGIN IMMEDIATE serializes against any other writer attempting the
  // same operation, so two would-be stealers cannot both win.
  const txn = db.transaction((): AcquireLockResult => {
    const existing = db
      .prepare('SELECT phase, holder, acquired_at, expires_at FROM dream_locks WHERE phase = ?')
      .get(args.phase) as LockRowRaw | undefined;

    if (!existing) {
      db.prepare(
        'INSERT INTO dream_locks (phase, holder, acquired_at, expires_at) VALUES (?, ?, ?, ?)',
      ).run(args.phase, holder, args.now, expiresAt);
      return { acquired: true, holder, reason: 'acquired' };
    }

    if (existing.expires_at <= args.now) {
      db.prepare(
        'UPDATE dream_locks SET holder = ?, acquired_at = ?, expires_at = ? WHERE phase = ?',
      ).run(holder, args.now, expiresAt, args.phase);
      return { acquired: true, holder, reason: 'stolen-stale' };
    }

    return { acquired: false, holder: existing.holder, reason: 'held' };
  });

  return txn.immediate();
}

export function releaseLock(db: Database.Database, phase: DreamPhase, holder: string): boolean {
  const info = db
    .prepare('DELETE FROM dream_locks WHERE phase = ? AND holder = ?')
    .run(phase, holder);
  return info.changes > 0;
}
