/**
 * Tests for dream-schema — per-mind better-sqlite3 schema bootstrap.
 *
 * Phase 7 acceptance:
 *   - migrate() is idempotent.
 *   - openDreamDb() materializes the parent .state directory.
 *   - WAL pragma is applied on file-backed DBs.
 *   - dream_state singleton row exists after migrate.
 *   - dream_state has the new last_consolidated_turn_id TEXT NULL column.
 *   - dream_locks and dream_runs tables exist with the expected columns.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';

import { dreamDbPath, migrate, openDreamDb } from './dream-schema';

let mindRoot: string;

beforeEach(() => {
  mindRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-dream-schema-'));
});

afterEach(() => {
  fs.rmSync(mindRoot, { recursive: true, force: true });
});

function tableInfo(db: Database.Database, table: string): Array<{ name: string; type: string; notnull: number; dflt_value: unknown; pk: number }> {
  return db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
    type: string;
    notnull: number;
    dflt_value: unknown;
    pk: number;
  }>;
}

describe('dream-schema — dreamDbPath', () => {
  it('puts the database under <mindPath>/.working-memory/.state/dream.db', () => {
    const p = dreamDbPath('/tmp/some/mind');
    expect(p.replace(/\\/g, '/')).toBe('/tmp/some/mind/.working-memory/.state/dream.db');
  });
});

describe('dream-schema — openDreamDb', () => {
  it('creates the parent .state directory and opens a WAL-mode database', () => {
    const dbPath = dreamDbPath(mindRoot);
    const db = openDreamDb(dbPath);
    try {
      expect(fs.existsSync(path.dirname(dbPath))).toBe(true);
      expect(fs.existsSync(dbPath)).toBe(true);
      const mode = db.pragma('journal_mode', { simple: true });
      expect(mode).toBe('wal');
    } finally {
      db.close();
    }
  });

  it('seeds the dream_state singleton row on first open', () => {
    const dbPath = dreamDbPath(mindRoot);
    const db = openDreamDb(dbPath);
    try {
      const row = db
        .prepare('SELECT id, turns_since_last_run, last_consolidated_turn_id FROM dream_state')
        .all() as Array<{ id: number; turns_since_last_run: number; last_consolidated_turn_id: string | null }>;
      expect(row).toHaveLength(1);
      expect(row[0].id).toBe(1);
      expect(row[0].turns_since_last_run).toBe(0);
      expect(row[0].last_consolidated_turn_id).toBeNull();
    } finally {
      db.close();
    }
  });
});

describe('dream-schema — migrate idempotency', () => {
  it('running migrate twice is a no-op (no error, no duplicate seed row)', () => {
    const db = new Database(':memory:');
    try {
      migrate(db);
      migrate(db);
      const rows = db.prepare('SELECT id FROM dream_state').all() as Array<{ id: number }>;
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(1);
    } finally {
      db.close();
    }
  });

  it('preserves user-written state across re-migration', () => {
    const db = new Database(':memory:');
    try {
      migrate(db);
      db.prepare('UPDATE dream_state SET turns_since_last_run = 42, last_consolidated_turn_id = ? WHERE id = 1').run(
        'turn-xyz',
      );
      migrate(db);
      const row = db
        .prepare('SELECT turns_since_last_run, last_consolidated_turn_id FROM dream_state WHERE id = 1')
        .get() as { turns_since_last_run: number; last_consolidated_turn_id: string };
      expect(row.turns_since_last_run).toBe(42);
      expect(row.last_consolidated_turn_id).toBe('turn-xyz');
    } finally {
      db.close();
    }
  });
});

describe('dream-schema — table shapes', () => {
  it('dream_state has the required columns including last_consolidated_turn_id TEXT NULL', () => {
    const db = new Database(':memory:');
    try {
      migrate(db);
      const cols = tableInfo(db, 'dream_state');
      const byName = new Map(cols.map((c) => [c.name, c]));
      expect(byName.has('id')).toBe(true);
      expect(byName.has('turns_since_last_run')).toBe(true);
      expect(byName.has('last_daily_at')).toBe(true);
      expect(byName.has('last_weekly_at')).toBe(true);
      expect(byName.has('last_monthly_at')).toBe(true);
      expect(byName.has('last_consolidated_turn_id')).toBe(true);
      const lcti = byName.get('last_consolidated_turn_id')!;
      expect(lcti.type).toBe('TEXT');
      expect(lcti.notnull).toBe(0);
    } finally {
      db.close();
    }
  });

  it('dream_locks has phase/holder/acquired_at/expires_at', () => {
    const db = new Database(':memory:');
    try {
      migrate(db);
      const cols = tableInfo(db, 'dream_locks').map((c) => c.name);
      expect(cols).toEqual(expect.arrayContaining(['phase', 'holder', 'acquired_at', 'expires_at']));
    } finally {
      db.close();
    }
  });

  it('dream_runs has phase/started_at/ended_at/status/reason/from_turn_id/to_turn_id', () => {
    const db = new Database(':memory:');
    try {
      migrate(db);
      const cols = tableInfo(db, 'dream_runs').map((c) => c.name);
      expect(cols).toEqual(
        expect.arrayContaining([
          'id',
          'phase',
          'started_at',
          'ended_at',
          'status',
          'reason',
          'from_turn_id',
          'to_turn_id',
        ]),
      );
    } finally {
      db.close();
    }
  });
});
