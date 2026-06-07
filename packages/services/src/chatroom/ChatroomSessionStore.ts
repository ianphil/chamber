import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  ChatroomMessage,
  ChatroomSessionRecord,
  ChatroomSessionSummary,
  ChatroomTranscript,
  TaskLedgerItem,
} from '@chamber/shared/chatroom-types';

const SESSIONS_DIR = 'chatroom-sessions';
const SESSION_FILE_SUFFIX = '.json';
const ACTIVE_POINTER_FILE = 'active.json';
const LEGACY_TRANSCRIPT_FILE = 'chatroom.json';
const LEGACY_BACKUP_FILE = 'chatroom.json.legacy';
const DEFAULT_NEW_TITLE = 'New chatroom';
const MIGRATED_TITLE = 'Chatroom 1';

interface ActivePointer {
  version: 1;
  sessionId: string | null;
}

interface CreateOptions {
  /** Title to use for the session. Defaults to {@link DEFAULT_NEW_TITLE}. */
  title?: string;
  /** Pre-existing transcript to wrap (used by the legacy migration path). */
  transcript?: ChatroomTranscript;
  /** Override the generated id (used by the legacy migration path). */
  sessionId?: string;
}

/**
 * File-backed store for named chatroom sessions.
 *
 * Layout under `userDataDir`:
 *   chatroom-sessions/
 *     active.json              -- pointer to the currently-active sessionId
 *     <sessionId>.json         -- one file per session ({@link ChatroomSessionRecord})
 *
 * The store owns persistence and id assignment only. Mutation of the in-flight
 * transcript (appending messages, updating the ledger) stays with ChatroomService
 * -- this store provides load/save/list/rename/delete primitives plus the
 * one-time migration from the legacy single-transcript layout.
 */
export class ChatroomSessionStore {
  private readonly sessionsDir: string;
  private readonly activePointerPath: string;

  constructor(private readonly userDataDir: string) {
    this.sessionsDir = path.join(userDataDir, SESSIONS_DIR);
    this.activePointerPath = path.join(this.sessionsDir, ACTIVE_POINTER_FILE);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Ensure the sessions directory exists and run the legacy migration once.
   * Idempotent: safe to call on every service startup.
   */
  initialize(): void {
    fs.mkdirSync(this.sessionsDir, { recursive: true });
    this.migrateLegacyTranscriptIfNeeded();
  }

  // -------------------------------------------------------------------------
  // Active session pointer
  // -------------------------------------------------------------------------

  /** Read the persisted active-session id, or null if none/missing/invalid. */
  getActiveSessionId(): string | null {
    try {
      if (!fs.existsSync(this.activePointerPath)) return null;
      const raw = fs.readFileSync(this.activePointerPath, 'utf-8');
      const parsed = JSON.parse(raw) as ActivePointer;
      if (parsed.version !== 1) return null;
      if (typeof parsed.sessionId !== 'string' && parsed.sessionId !== null) return null;
      // Don't dangle: clear the pointer if the session file is gone.
      if (parsed.sessionId && !this.sessionExists(parsed.sessionId)) {
        this.setActiveSessionId(null);
        return null;
      }
      return parsed.sessionId;
    } catch {
      return null;
    }
  }

  setActiveSessionId(sessionId: string | null): void {
    try {
      fs.mkdirSync(this.sessionsDir, { recursive: true });
      const pointer: ActivePointer = { version: 1, sessionId };
      const tmp = this.activePointerPath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(pointer, null, 2));
      fs.renameSync(tmp, this.activePointerPath);
    } catch {
      // Pointer is a hint, not a contract -- failure is non-fatal.
    }
  }

  // -------------------------------------------------------------------------
  // List / load / create / save / rename / delete
  // -------------------------------------------------------------------------

  /**
   * Return summaries for all persisted sessions, newest first. Marks the
   * session matching `getActiveSessionId()` as `active: true`.
   */
  list(): ChatroomSessionSummary[] {
    if (!fs.existsSync(this.sessionsDir)) return [];
    const activeId = this.getActiveSessionId();
    const entries = fs.readdirSync(this.sessionsDir, { withFileTypes: true });
    const summaries: ChatroomSessionSummary[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(SESSION_FILE_SUFFIX)) continue;
      if (entry.name === ACTIVE_POINTER_FILE) continue;
      const sessionId = entry.name.slice(0, -SESSION_FILE_SUFFIX.length);
      const record = this.loadRecordSafe(sessionId);
      if (!record) continue;
      summaries.push(this.toSummary(record, activeId));
    }
    summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return summaries;
  }

  /** Load a session by id, or throw if it does not exist or is corrupt. */
  load(sessionId: string): ChatroomSessionRecord {
    const record = this.loadRecordSafe(sessionId);
    if (!record) throw new Error(`Chatroom session not found: ${sessionId}`);
    return record;
  }

  /**
   * Create a new empty session and persist it. Does NOT set it active --
   * callers (ChatroomService) decide when to flip the active pointer.
   */
  create(options: CreateOptions = {}): ChatroomSessionRecord {
    fs.mkdirSync(this.sessionsDir, { recursive: true });
    const now = new Date().toISOString();
    const record: ChatroomSessionRecord = {
      version: 1,
      sessionId: options.sessionId ?? randomUUID(),
      title: options.title?.trim() || DEFAULT_NEW_TITLE,
      createdAt: now,
      updatedAt: now,
      transcript: options.transcript ?? {
        version: 1,
        messages: [],
        taskLedger: [],
        disabledMindIds: [],
      },
    };
    this.saveRecord(record);
    return record;
  }

  /**
   * Persist a transcript update for an existing session and bump updatedAt.
   * Title and createdAt are preserved.
   */
  save(sessionId: string, transcript: ChatroomTranscript): ChatroomSessionRecord {
    const existing = this.load(sessionId);
    const updated: ChatroomSessionRecord = {
      ...existing,
      transcript,
      updatedAt: new Date().toISOString(),
    };
    this.saveRecord(updated);
    return updated;
  }

  rename(sessionId: string, title: string): ChatroomSessionRecord {
    const cleaned = title.trim();
    if (cleaned.length === 0) {
      throw new Error('Chatroom session title cannot be empty.');
    }
    const existing = this.load(sessionId);
    const updated: ChatroomSessionRecord = {
      ...existing,
      title: cleaned,
      updatedAt: new Date().toISOString(),
    };
    this.saveRecord(updated);
    return updated;
  }

  /**
   * Delete a session's persistence. If the deleted session was active, the
   * active pointer is cleared (callers can pick a new active session from
   * the remaining list).
   */
  delete(sessionId: string): void {
    const filePath = this.sessionFilePath(sessionId);
    try {
      fs.rmSync(filePath, { force: true });
    } catch {
      // missing is fine
    }
    if (this.getActiveSessionId() === sessionId) {
      this.setActiveSessionId(null);
    }
  }

  // -------------------------------------------------------------------------
  // Legacy migration
  //
  // The pre-sessions ChatroomService persisted a single `chatroom.json` at
  // userData root. When this store first runs on an upgraded install, wrap
  // that file as a session called "Chatroom 1" and rename it so the
  // migration only fires once.
  // -------------------------------------------------------------------------

  private migrateLegacyTranscriptIfNeeded(): void {
    const legacyPath = path.join(this.userDataDir, LEGACY_TRANSCRIPT_FILE);
    if (!fs.existsSync(legacyPath)) return;

    try {
      const raw = fs.readFileSync(legacyPath, 'utf-8');
      const transcript = JSON.parse(raw) as ChatroomTranscript;
      if (transcript.version !== 1 || !Array.isArray(transcript.messages)) {
        // Unknown shape; back up but do not import.
        fs.renameSync(legacyPath, path.join(this.userDataDir, LEGACY_BACKUP_FILE));
        return;
      }
      const created = this.create({
        title: MIGRATED_TITLE,
        transcript: {
          version: 1,
          messages: transcript.messages,
          taskLedger: Array.isArray(transcript.taskLedger) ? transcript.taskLedger : [],
          disabledMindIds: Array.isArray(transcript.disabledMindIds)
            ? transcript.disabledMindIds.filter((id): id is string => typeof id === 'string')
            : [],
        },
      });
      // Make the migrated session the active one by default so users see
      // their prior chatroom on first launch after upgrading.
      this.setActiveSessionId(created.sessionId);
      // Rename so the next startup does not re-migrate.
      fs.renameSync(legacyPath, path.join(this.userDataDir, LEGACY_BACKUP_FILE));
    } catch {
      // If anything goes wrong, leave the legacy file alone; user can
      // re-attempt after fixing the corruption.
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private sessionExists(sessionId: string): boolean {
    return fs.existsSync(this.sessionFilePath(sessionId));
  }

  private sessionFilePath(sessionId: string): string {
    return path.join(this.sessionsDir, sessionId + SESSION_FILE_SUFFIX);
  }

  private loadRecordSafe(sessionId: string): ChatroomSessionRecord | null {
    try {
      const filePath = this.sessionFilePath(sessionId);
      if (!fs.existsSync(filePath)) return null;
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as ChatroomSessionRecord;
      if (parsed.version !== 1 || typeof parsed.sessionId !== 'string') return null;
      if (typeof parsed.title !== 'string') return null;
      if (!parsed.transcript || !Array.isArray(parsed.transcript.messages)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private saveRecord(record: ChatroomSessionRecord): void {
    fs.mkdirSync(this.sessionsDir, { recursive: true });
    const filePath = this.sessionFilePath(record.sessionId);
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(record, null, 2));
    fs.renameSync(tmp, filePath);
  }

  private toSummary(record: ChatroomSessionRecord, activeId: string | null): ChatroomSessionSummary {
    const hasMessages = record.transcript.messages.some(
      (m: ChatroomMessage) => m.role === 'user' || m.role === 'assistant',
    );
    return {
      sessionId: record.sessionId,
      title: record.title,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      active: activeId === record.sessionId,
      hasMessages,
    };
  }

  // Internal helper exposed for tests that want a sanity TaskLedger snapshot
  // without round-tripping through ChatroomService.
  static defaultEmptyTranscript(): ChatroomTranscript {
    return { version: 1, messages: [], taskLedger: [] satisfies TaskLedgerItem[], disabledMindIds: [] };
  }
}
