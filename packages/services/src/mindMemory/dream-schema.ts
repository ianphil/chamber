/**
 * dream-schema — per-mind better-sqlite3 schema bootstrap for the Dream
 * Daemon's local state, locks, and run history.
 *
 * Database location: `<mindPath>/.working-memory/.state/dream.db`.
 * Journal mode: WAL (durable, multi-reader, single-writer).
 *
 * Tables (all created idempotently by `migrate`):
 *
 *   dream_state       Singleton (id=1) row tracking per-phase last-run
 *                     timestamps, the activity counter
 *                     (`turns_since_last_run`), and the cutoff turn id of
 *                     the last successful daily consolidation
 *                     (`last_consolidated_turn_id`).
 *   dream_locks       One row per phase. Holder string, acquired_at, and
 *                     expires_at form a TTL-bounded mutex broken via
 *                     transactional steal in dream-state.acquireLock.
 *   dream_runs        Append-only run history (success | failed | skipped)
 *                     with optional reason and turn-id range processed.
 *
 * This module is I/O — it owns the dream.db file. dream-state.ts wraps it
 * with typed CRUD; dream-gates.ts and consolidation-scheduler.ts compose
 * on top.
 */

import fs from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

export type DreamPhase = 'daily' | 'weekly' | 'monthly';
export type DreamRunStatus = 'success' | 'failed' | 'skipped';

const WORKING_MEMORY_DIRNAME = '.working-memory';
const STATE_DIRNAME = '.state';
const DREAM_DB_FILENAME = 'dream.db';

export function dreamDbPath(mindPath: string): string {
  return path.join(mindPath, WORKING_MEMORY_DIRNAME, STATE_DIRNAME, DREAM_DB_FILENAME);
}

export function openDreamDb(dbPath: string): Database.Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

export function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS dream_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      turns_since_last_run INTEGER NOT NULL DEFAULT 0,
      last_daily_at INTEGER,
      last_weekly_at INTEGER,
      last_monthly_at INTEGER,
      last_consolidated_turn_id TEXT
    );

    CREATE TABLE IF NOT EXISTS dream_locks (
      phase TEXT PRIMARY KEY,
      holder TEXT NOT NULL,
      acquired_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dream_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phase TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      status TEXT NOT NULL,
      reason TEXT,
      from_turn_id TEXT,
      to_turn_id TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_dream_runs_phase_started
      ON dream_runs (phase, started_at DESC);
  `);

  // Seed the singleton row. INSERT OR IGNORE keeps migrate idempotent and
  // preserves user-written state across re-opens.
  db.prepare('INSERT OR IGNORE INTO dream_state (id) VALUES (1)').run();
}
