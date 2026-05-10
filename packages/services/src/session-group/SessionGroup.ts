import type { CopilotSession } from '../mind';
import type { PermissionHandlerFactory, SessionGroupSessionFactory } from './types';
import type {
  SessionGroupOrchestrator,
  SessionGroupRunOptions,
  SessionGroupRunContext,
} from './orchestrators/types';

// ---------------------------------------------------------------------------
// SessionGroup — Chamber-internal, SDK-shaped adapter
// ---------------------------------------------------------------------------

/**
 * Owns a per-participant cache of `CopilotSession` objects and the
 * lifecycle operations on them: get-or-create, evict, abort all,
 * destroy all, destroy one. Permission-handler injection is delegated
 * to a caller-supplied factory so the approval policy stays a product
 * concern.
 *
 * Phase 1 surface: lifecycle only. Streaming, retry, and orchestrator
 * dispatch land in subsequent phases. ChatroomService delegates to an
 * instance of this class but keeps its public API unchanged.
 */
export class SessionGroup {
  private readonly sessionCache = new Map<string, CopilotSession>();
  private activeOrchestrator: SessionGroupOrchestrator | null = null;

  constructor(
    private readonly sessionFactory: SessionGroupSessionFactory,
    private readonly permissionHandlerFactory: PermissionHandlerFactory,
  ) {}

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async getOrCreateSession(mindId: string): Promise<CopilotSession> {
    let session = this.sessionCache.get(mindId);
    if (!session) {
      session = await this.sessionFactory.createChatroomSession(
        mindId,
        this.permissionHandlerFactory(mindId),
      );
      this.sessionCache.set(mindId, session);
    }
    return session;
  }

  /** Drop a session from the cache without aborting it (caller already knows it's stale). */
  evictSession(mindId: string): void {
    this.sessionCache.delete(mindId);
  }

  /**
   * Abort every cached session and clear the cache. Used between rounds so
   * the next round gets fresh sessions. Errors from `abort` are swallowed
   * to match the prior `ChatroomService.stopAll` semantics — a failing
   * abort must not block round teardown.
   */
  abortAll(): void {
    for (const [, session] of this.sessionCache) {
      session.abort().catch(() => { /* noop */ });
    }
    this.sessionCache.clear();
  }

  /**
   * Destroy every cached session and clear the cache. Used by
   * `ChatroomService.clearHistory`. Errors are swallowed for the same
   * reason as `abortAll`.
   */
  async destroyAll(): Promise<void> {
    for (const [, session] of this.sessionCache) {
      await session.destroy().catch(() => { /* noop */ });
    }
    this.sessionCache.clear();
  }

  /**
   * Abort + destroy + remove a single mind's session. Used when a mind is
   * unloaded so its session cannot be reused. Errors swallowed for parity
   * with the previous `handleMindUnloaded` implementation.
   */
  destroySession(mindId: string): void {
    const session = this.sessionCache.get(mindId);
    if (!session) return;
    session.abort().catch(() => { /* noop */ });
    session.destroy().catch(() => { /* noop */ });
    this.sessionCache.delete(mindId);
  }

  // -------------------------------------------------------------------------
  // Orchestrator dispatch
  // -------------------------------------------------------------------------

  /**
   * Dispatch an orchestrator. Tracks the active orchestrator so
   * `stopActiveRun()` can cancel it. Resets `activeOrchestrator` once
   * `execute` resolves or throws so a subsequent `stopActiveRun()` is a
   * no-op rather than re-stopping a finished run.
   */
  async run(opts: SessionGroupRunOptions): Promise<void> {
    const { orchestrator, prompt, participants, roundId, product } = opts;
    this.activeOrchestrator = orchestrator;
    const runContext: SessionGroupRunContext = {
      group: this,
      product,
      orchestrationMode: orchestrator.mode,
    };
    try {
      await orchestrator.execute(prompt, participants, roundId, runContext);
    } finally {
      if (this.activeOrchestrator === orchestrator) {
        this.activeOrchestrator = null;
      }
    }
  }

  /** Stop the active orchestrator (if any). Safe to call when idle. */
  stopActiveRun(): void {
    if (!this.activeOrchestrator) return;
    const o = this.activeOrchestrator;
    this.activeOrchestrator = null;
    o.stop();
  }

  /** Whether an orchestrator is currently active. Test/diagnostic surface. */
  get isRunning(): boolean {
    return this.activeOrchestrator !== null;
  }

  // -------------------------------------------------------------------------
  // Introspection (test surface)
  // -------------------------------------------------------------------------

  /** Number of cached sessions. Intended for tests/diagnostics. */
  get size(): number {
    return this.sessionCache.size;
  }

  /** Whether a session is cached for `mindId`. Intended for tests/diagnostics. */
  has(mindId: string): boolean {
    return this.sessionCache.has(mindId);
  }
}
