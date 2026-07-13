import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import { createRequire } from 'node:module';
import type DatabaseConstructor from 'better-sqlite3';
import type {
  A2AInboundApprovalRequest,
  A2AInboundApprovalState,
} from './types';
import type { InboundA2AApprovalStore } from './InboundA2AApprovalService';

const SCHEMA_VERSION = 1;

let injectedDatabaseCtor: typeof DatabaseConstructor | null = null;

export function setInboundA2ASqliteDatabase(ctor: typeof DatabaseConstructor): void {
  injectedDatabaseCtor = ctor;
}

function resolveDatabaseCtor(): typeof DatabaseConstructor {
  if (injectedDatabaseCtor) return injectedDatabaseCtor;
  const requireFromHere = createRequire(__filename);
  return requireFromHere('better-sqlite3') as typeof DatabaseConstructor;
}

interface ApprovalRow {
  record_json: string;
}

export class SQLiteInboundA2AApprovalStore implements InboundA2AApprovalStore {
  private readonly db: DatabaseConstructor.Database;

  constructor(readonly path: string) {
    fs.mkdirSync(nodePath.dirname(path), { recursive: true });
    const Database = resolveDatabaseCtor();
    this.db = new Database(path);
    this.db.pragma('busy_timeout = 5000');
    this.migrate();
  }

  create(request: A2AInboundApprovalRequest): boolean {
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO inbound_a2a_approvals (
        approval_id,
        digest,
        state,
        expires_at,
        record_json
      ) VALUES (
        @id,
        @digest,
        @state,
        @expiresAt,
        @recordJson
      )
    `).run({
      id: request.id,
      digest: request.digest,
      state: request.state,
      expiresAt: request.expiresAt,
      recordJson: JSON.stringify(request),
    });
    return result.changes > 0;
  }

  get(id: string): A2AInboundApprovalRequest | null {
    const row = this.db
      .prepare('SELECT record_json FROM inbound_a2a_approvals WHERE approval_id = ?')
      .get(id) as ApprovalRow | undefined;
    return row ? parseRequest(row) : null;
  }

  listPending(): A2AInboundApprovalRequest[] {
    const rows = this.db.prepare(`
      SELECT record_json
      FROM inbound_a2a_approvals
      WHERE state = 'pending'
      ORDER BY json_extract(record_json, '$.receivedAt'), approval_id
    `).all() as ApprovalRow[];
    return rows.map(parseRequest);
  }

  claimPending(id: string, digest: string, decidedAt: string): A2AInboundApprovalRequest | null {
    return this.transition(id, digest, ['pending'], 'approved', decidedAt);
  }

  markDelivered(id: string, decidedAt: string): A2AInboundApprovalRequest | null {
    return this.transition(id, undefined, ['approved', 'delivery_failed'], 'delivered', decidedAt);
  }

  markDeliveryFailed(
    id: string,
    error: string,
    decidedAt: string,
  ): A2AInboundApprovalRequest | null {
    return this.transition(id, undefined, ['approved'], 'delivery_failed', decidedAt, error);
  }

  declinePending(id: string, digest: string, decidedAt: string): A2AInboundApprovalRequest | null {
    return this.transition(id, digest, ['pending'], 'declined', decidedAt);
  }

  expirePending(id: string, digest: string, decidedAt: string): A2AInboundApprovalRequest | null {
    return this.transition(id, digest, ['pending'], 'expired', decidedAt);
  }

  close(): void {
    this.db.close();
  }

  private transition(
    id: string,
    digest: string | undefined,
    fromStates: A2AInboundApprovalState[],
    state: A2AInboundApprovalState,
    decidedAt: string,
    error?: string,
  ): A2AInboundApprovalRequest | null {
    const update = this.db.transaction(() => {
      const current = this.get(id);
      if (
        !current
        || (digest !== undefined && current.digest !== digest)
        || !fromStates.includes(current.state)
      ) {
        return null;
      }
      const next: A2AInboundApprovalRequest = {
        ...current,
        state,
        decidedAt,
        ...(error ? { error } : {}),
      };
      const result = this.db.prepare(`
        UPDATE inbound_a2a_approvals
        SET state = @state, record_json = @recordJson
        WHERE approval_id = @id AND digest = @digest AND state = @currentState
      `).run({
        id,
        digest: current.digest,
        currentState: current.state,
        state,
        recordJson: JSON.stringify(next),
      });
      return result.changes === 1 ? next : null;
    });
    return update();
  }

  private migrate(): void {
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    const version = this.db.pragma('user_version', { simple: true }) as number;
    if (version > SCHEMA_VERSION) {
      throw new Error(`Unsupported inbound A2A approval schema version: ${version}`);
    }
    if (version === SCHEMA_VERSION) return;

    const migrate = this.db.transaction(() => {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS inbound_a2a_approvals (
          approval_id TEXT PRIMARY KEY NOT NULL,
          digest TEXT NOT NULL,
          state TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          record_json TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_inbound_a2a_approvals_pending
          ON inbound_a2a_approvals(state, expires_at);
      `);
      this.db.pragma(`user_version = ${SCHEMA_VERSION}`);
    });
    migrate();
  }
}

function parseRequest(row: ApprovalRow): A2AInboundApprovalRequest {
  return JSON.parse(row.record_json) as A2AInboundApprovalRequest;
}
