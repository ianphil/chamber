import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { LedgerDataError } from './errors';
import type { LedgerStore } from './LedgerStore';
import { describeLedgerStoreContract } from './LedgerStore.contract';
import { SQLiteLedgerStore } from './SQLiteLedgerStore';

function makeDbPath(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-ledger-sqlite-'));
  return path.join(tmpDir, '.chamber', 'runs', 'tasks.db');
}

function removeDbPath(dbPath: string): void {
  fs.rmSync(path.dirname(path.dirname(path.dirname(dbPath))), { recursive: true, force: true });
}

describe('SQLiteLedgerStore', () => {
  it('creates a versioned WAL database under the requested path', () => {
    const dbPath = makeDbPath();
    try {
      const store = new SQLiteLedgerStore(dbPath);
      store.close();

      const db = new Database(dbPath);
      try {
        expect(db.pragma('user_version', { simple: true })).toBe(1);
        expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
        expect(db.pragma('synchronous', { simple: true })).toBe(1);
        expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
      } finally {
        db.close();
      }
    } finally {
      removeDbPath(dbPath);
    }
  });

  it('wraps raw duplicate runtime/runKey constraint failures as LedgerDataError', () => {
    const dbPath = makeDbPath();
    try {
      const store = new SQLiteLedgerStore(dbPath);
      try {
        store.upsert({
          ledgerId: 'ledger-1',
          runKey: 'same-run',
          runtime: 'local',
          ownerMindId: 'mind-1',
          scopeKind: 'system',
          task: 'one',
          status: 'running',
          notifyPolicy: 'silent',
          deliveryStatus: 'not-applicable',
          createdAt: '2026-05-21T00:00:00.000Z',
          payload: { runtime: 'local' },
        });

        expect(() => store.upsert({
          ledgerId: 'ledger-2',
          runKey: 'same-run',
          runtime: 'local',
          ownerMindId: 'mind-1',
          scopeKind: 'system',
          task: 'two',
          status: 'running',
          notifyPolicy: 'silent',
          deliveryStatus: 'not-applicable',
          createdAt: '2026-05-21T00:00:01.000Z',
          payload: { runtime: 'local' },
        })).toThrow(LedgerDataError);
      } finally {
        store.close();
      }
    } finally {
      removeDbPath(dbPath);
    }
  });

  it('uses the sweep index for stale running-record queries', () => {
    const dbPath = makeDbPath();
    try {
      const store = new SQLiteLedgerStore(dbPath);
      store.close();

      const db = new Database(dbPath);
      try {
        const plan = db.prepare(`
          EXPLAIN QUERY PLAN
          SELECT record_json
          FROM ledger_records
          WHERE status = ? AND last_event_at < ?
        `).all('running', '2026-05-21T21:00:00.000Z');
        expect(JSON.stringify(plan)).toContain('idx_ledger_sweep');
      } finally {
        db.close();
      }
    } finally {
      removeDbPath(dbPath);
    }
  });
});

describeLedgerStoreContract('SQLiteLedgerStore', {
  createStore: () => new SQLiteLedgerStore(makeDbPath()),
  destroyStore: (store: LedgerStore) => {
    const sqlite = store as SQLiteLedgerStore;
    const dbPath = sqlite.path;
    sqlite.close();
    removeDbPath(dbPath);
  },
});
