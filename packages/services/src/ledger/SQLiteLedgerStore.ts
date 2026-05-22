import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import Database from 'better-sqlite3';
import type { LedgerRecord, LedgerStatus, TaskRuntime } from '@chamber/shared';
import { LedgerDataError } from './errors';
import type { LedgerStore } from './LedgerStore';

const SCHEMA_VERSION = 1;

interface LedgerRow {
  record_json: string;
}

export class SQLiteLedgerStore implements LedgerStore {
  private readonly db: Database.Database;

  constructor(readonly path: string) {
    fs.mkdirSync(nodePath.dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma('busy_timeout = 5000');
    this.migrate();
  }

  upsert(record: LedgerRecord): void {
    try {
      this.db.prepare(`
        INSERT INTO ledger_records (
          ledger_id,
          runtime,
          run_key,
          status,
          last_event_at,
          record_json
        ) VALUES (
          @ledgerId,
          @runtime,
          @runKey,
          @status,
          @lastEventAt,
          @recordJson
        )
        ON CONFLICT(ledger_id) DO UPDATE SET
          runtime = excluded.runtime,
          run_key = excluded.run_key,
          status = excluded.status,
          last_event_at = excluded.last_event_at,
          record_json = excluded.record_json
      `).run({
        ledgerId: record.ledgerId,
        runtime: record.runtime,
        runKey: record.runKey ?? null,
        status: record.status,
        lastEventAt: record.lastEventAt ?? null,
        recordJson: JSON.stringify(record),
      });
    } catch (err) {
      if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
        throw new LedgerDataError(
          `Duplicate ledger runKey for runtime ${record.runtime}: ${record.runKey}`,
          { cause: err },
        );
      }
      throw err;
    }
  }

  findByLedgerId(ledgerId: string): LedgerRecord | undefined {
    const row = this.db
      .prepare('SELECT record_json FROM ledger_records WHERE ledger_id = ?')
      .get(ledgerId) as LedgerRow | undefined;
    return row ? this.parseRecord(row) : undefined;
  }

  findByRunKey(runtime: TaskRuntime, runKey: string): LedgerRecord | undefined {
    const row = this.db
      .prepare('SELECT record_json FROM ledger_records WHERE runtime = ? AND run_key = ?')
      .get(runtime, runKey) as LedgerRow | undefined;
    return row ? this.parseRecord(row) : undefined;
  }

  listByRuntime(runtime: TaskRuntime): LedgerRecord[] {
    const rows = this.db
      .prepare('SELECT record_json FROM ledger_records WHERE runtime = ? ORDER BY created_at, ledger_id')
      .all(runtime) as LedgerRow[];
    return rows.map((row) => this.parseRecord(row));
  }

  listByStatus(status: LedgerStatus): LedgerRecord[] {
    const rows = this.db
      .prepare('SELECT record_json FROM ledger_records WHERE status = ? ORDER BY created_at, ledger_id')
      .all(status) as LedgerRow[];
    return rows.map((row) => this.parseRecord(row));
  }

  deleteByLedgerId(ledgerId: string): boolean {
    const result = this.db
      .prepare('DELETE FROM ledger_records WHERE ledger_id = ?')
      .run(ledgerId);
    return result.changes > 0;
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    const version = this.db.pragma('user_version', { simple: true }) as number;
    if (version > SCHEMA_VERSION) {
      throw new Error(`Unsupported ledger schema version: ${version}`);
    }
    if (version === SCHEMA_VERSION) return;

    const migrate = this.db.transaction(() => {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS ledger_records (
          ledger_id TEXT PRIMARY KEY NOT NULL,
          runtime TEXT NOT NULL,
          run_key TEXT,
          status TEXT NOT NULL,
          last_event_at TEXT,
          created_at TEXT GENERATED ALWAYS AS (json_extract(record_json, '$.createdAt')) VIRTUAL,
          record_json TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_ledger_records_runtime_run_key
          ON ledger_records(runtime, run_key)
          WHERE run_key IS NOT NULL;

        CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_records_runtime_run_key_unique
          ON ledger_records(runtime, run_key)
          WHERE run_key IS NOT NULL;

        CREATE INDEX IF NOT EXISTS idx_ledger_records_status_created_at
          ON ledger_records(status, created_at);

        CREATE INDEX IF NOT EXISTS idx_ledger_records_runtime_created_at
          ON ledger_records(runtime, created_at);

        CREATE INDEX IF NOT EXISTS idx_ledger_sweep
          ON ledger_records(status, last_event_at);
      `);
      this.db.pragma(`user_version = ${SCHEMA_VERSION}`);
    });
    migrate();
  }

  private parseRecord(row: LedgerRow): LedgerRecord {
    return JSON.parse(row.record_json) as LedgerRecord;
  }
}
