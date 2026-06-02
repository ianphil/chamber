/**
 * MindMemoryService — Phase 11 of the Dream Daemon spike.
 *
 * Per-mind lifecycle layer that turns the Phase 1–10 collaborators into a
 * single activate / release / close API:
 *
 *   - `activateMind(mindId, mindPath)` reads `.chamber.json`, opts the mind
 *     in only if `workingMemory.consolidation.enabled === true`, opens the
 *     per-mind `dream.db`, builds vault/archive/daemon via injected
 *     factories, registers an `InternalScheduler` entry whose fn drives
 *     `daemon.run()`, and registers a `TurnCompletionObserver` on
 *     ChatService that forwards completed turns to the per-mind
 *     `DailyLogWriter`.
 *
 *   - `releaseMind(mindId)` is the exact inverse: scheduler.unregister →
 *     remove observer → daemon.close → db.close → drop from internal map.
 *     Idempotent. No-op for unknown / disabled mind ids.
 *
 *   - `close()` releases every activated mind sequentially, then refuses
 *     subsequent activate calls (fail-fast — keeps the lifecycle invariant
 *     visible rather than silently leaking minds after global teardown).
 *
 * Documented choices:
 *
 *   1. Strict opt-in: `enabled !== true` (NOT just truthy) means OFF. Even
 *      DailyLogWriter is NOT registered when consolidation is opted out —
 *      we don't write structured turn frames to disk for minds that haven't
 *      asked for the feature.
 *
 *   2. `activateMind` for an already-activated mind is an idempotent no-op.
 *      Callers must `releaseMind` first to swap configuration; we never
 *      replace collaborators mid-flight (avoids db/observer leaks if
 *      `releaseMind` was forgotten on the previous activation).
 *
 *   3. ChatService observer wiring uses a tiny `addObserver` /
 *      `removeObserver` pair on ChatService itself (Phase 11 addition,
 *      smaller than introducing a separate registry abstraction). The
 *      service depends on the narrow `ChatObserverRegistry` interface so
 *      tests can fake it.
 *
 *   4. Activation errors are unwound in reverse construction order: a
 *      throw from `daemonFactory` closes the db; a throw from
 *      `scheduler.register` closes the daemon AND the db. The mind is
 *      never recorded as activated unless every step succeeded.
 */

import type Database from 'better-sqlite3';

import type { TurnCompletionObserver, CompletedTurn } from '@chamber/shared/turn-observer';

import { Logger } from '../logger';
import { loadChamberMindConfig, type ChamberMindConfig, type WorkingMemoryConsolidationConfig } from '../mind/chamberMindConfig';
import { createDailyLogWriter, type DailyLogWriter } from './DailyLogWriter';
import type { DreamDaemon } from './DreamDaemon';
import { dreamDbPath } from './dream-schema';
import { incrementTurnCount } from './dream-state';
import type { InternalScheduler } from './InternalScheduler';
import type { MindArchiveStore } from './MindArchiveStore';
import type { MindMemoryVault } from './MindMemoryVault';

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/** Default jitter window for daemon kick-off (defeats thundering herd at 03:00). */
const DEFAULT_JITTER_MS = 30_000;

/**
 * Narrow ChatService surface MindMemoryService depends on — just the
 * observer add/remove pair. Keeps the unit tests free of MindManager,
 * TurnQueue, and the SDK harness.
 */
export interface ChatObserverRegistry {
  addObserver(observer: TurnCompletionObserver): void;
  removeObserver(observer: TurnCompletionObserver): void;
}

export interface DaemonFactoryOptions {
  readonly mindId: string;
  readonly mindPath: string;
  readonly vault: MindMemoryVault;
  readonly archive: MindArchiveStore;
  readonly db: Database.Database;
  readonly config: WorkingMemoryConsolidationConfig;
}

export interface MindMemoryServiceFactories {
  readonly scheduler: InternalScheduler;
  readonly chatService: ChatObserverRegistry;
  readonly configReader: (mindPath: string) => ChamberMindConfig;
  readonly dbFactory: (dbPath: string) => Database.Database;
  readonly vaultFactory: (mindPath: string) => MindMemoryVault;
  readonly archiveFactory: (mindPath: string) => MindArchiveStore;
  readonly daemonFactory: (opts: DaemonFactoryOptions) => DreamDaemon;
  readonly logger?: Logger;
  /** Override jitter window (defaults to 30s). */
  readonly jitterMs?: number;
}

export interface MindMemoryService {
  activateMind(mindId: string, mindPath: string): Promise<void>;
  releaseMind(mindId: string): Promise<void>;
  close(): Promise<void>;
  /**
   * Test/E2E-only accessor. Returns the live `DreamDaemon` plus the
   * `dream.db` path for an active mind, or `null` if the mind is not
   * currently activated. Production code must NOT depend on this surface;
   * callers are expected to gate on `process.env.CHAMBER_E2E === '1'`.
   *
   * Lifecycle:
   *   - returns `null` for unknown / disabled mind ids
   *   - returns the same `daemon` reference handed back by `daemonFactory`
   *     during `activateMind`
   *   - returns `null` again after `releaseMind` (entry is removed from
   *     the internal active map)
   */
  __debugGet(mindId: string): {
    readonly daemon: DreamDaemon;
    readonly dbPath: string;
    readonly writer: DailyLogWriter;
  } | null;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

interface ActiveEntry {
  readonly mindPath: string;
  readonly dbPath: string;
  readonly db: Database.Database;
  readonly daemon: DreamDaemon;
  readonly writer: DailyLogWriter;
  readonly observer: TurnCompletionObserver;
}

export function createMindMemoryService(
  factories: MindMemoryServiceFactories,
): MindMemoryService {
  const log = factories.logger ?? Logger.create('MindMemoryService');
  const jitterMs = factories.jitterMs ?? DEFAULT_JITTER_MS;
  const active = new Map<string, ActiveEntry>();
  let closed = false;

  // Per-mindId serialization (Uncle Bob plan-review finding 2). The
  // composition root wires `mindManager.on('mind:loaded', ctx =>
  // mindMemoryService.activateMind(...).catch(...))` — fire-and-forget. A
  // user who rapid-toggles the dream-daemon switch (ON → OFF → ON) generates
  // back-to-back activate/release events. With the eager-migration await
  // added below, activate yields BEFORE calling `active.set`, opening a
  // race window where release no-ops (mind not yet active) and the next
  // activate's idempotency check no-ops too — leaving the mind in a stale
  // state. Serializing here keeps the contract intact at the service
  // layer, so the composition root can stay simple.
  const lifecycleQueues = new Map<string, Promise<void>>();

  function enqueueLifecycle<T>(mindId: string, fn: () => Promise<T>): Promise<T> {
    const prior = lifecycleQueues.get(mindId) ?? Promise.resolve();
    const next = prior.then(fn, fn);
    // Tail tracking — we keep the chain as a Promise<void> that swallows
    // rejections so a failed activate/release does not poison the queue.
    const tail: Promise<void> = next.then(
      () => undefined,
      () => undefined,
    );
    lifecycleQueues.set(mindId, tail);
    // Best-effort cleanup once the queue is fully drained for this mind.
    void tail.then(() => {
      if (lifecycleQueues.get(mindId) === tail) {
        lifecycleQueues.delete(mindId);
      }
    });
    return next;
  }

  function activateMind(mindId: string, mindPath: string): Promise<void> {
    return enqueueLifecycle(mindId, () => activateMindInner(mindId, mindPath));
  }

  function releaseMind(mindId: string): Promise<void> {
    return enqueueLifecycle(mindId, () => releaseMindInner(mindId));
  }

  async function activateMindInner(mindId: string, mindPath: string): Promise<void> {
    if (closed) {
      throw new Error('MindMemoryService is closed');
    }
    if (active.has(mindId)) {
      log.debug(`Mind ${mindId} already activated; activateMind is a no-op`);
      return;
    }

    const config = factories.configReader(mindPath);
    const consolidation = config.workingMemory?.consolidation;
    // Strict opt-in. `enabled !== true` (not just truthy) means OFF — also
    // means we do NOT register DailyLogWriter; the writer would otherwise
    // start materializing structured log frames for minds that never asked
    // for the feature, defeating the opt-in.
    if (!consolidation || consolidation.enabled !== true) {
      return;
    }

    // Build collaborators in dependency order; unwind on failure.
    let db: Database.Database | null = null;
    let daemon: DreamDaemon | null = null;
    let observer: TurnCompletionObserver | null = null;
    let registered = false;

    try {
      const vault = factories.vaultFactory(mindPath);
      const archive = factories.archiveFactory(mindPath);
      const dbPath = dreamDbPath(mindPath);
      db = factories.dbFactory(dbPath);

      daemon = factories.daemonFactory({
        mindId,
        mindPath,
        vault,
        archive,
        db,
        config: consolidation,
      });

      // DailyLogWriter is built inline — its construction is pure (no I/O
      // until a turn arrives), so injecting a writer factory would be
      // strictly more wiring without test value. Tests replace this surface
      // by faking ChatObserverRegistry and asserting one observer was added.
      //
      // INVARIANT: `onTurnRecorded` MUST bump `dream_state.turns_since_last_run`
      // — otherwise the daemon's activity gate (`minTurnsBetweenRuns >= 1` by
      // default) would block consolidation forever. Phase 11 spec wires this
      // hook; verified end-to-end by tests/integration/mindMemory.integration
      // and packages/services/src/mindMemory/MindMemoryService.test.ts.
      const dbForHook = db;
      const writer = createDailyLogWriter({
        mindId,
        mindPath,
        deps: {
          onTurnRecorded: () => {
            incrementTurnCount(dbForHook, 1);
          },
        },
      });

      // Eager migration (v0.60.0 Phase 1). When a mind that previously
      // opted out flips ON, the user expects their freeform log.md to be
      // preserved as log.legacy.md and a fresh sentinel-only log to be
      // seeded — without waiting for the next chat turn. Idempotent for
      // already-structured logs; no-op for missing log.md.
      await writer.migrateIfNeeded();

      observer = {
        onTurnCompleted: (turn: CompletedTurn) => writer.write(turn),
      };

      factories.scheduler.register({
        mindId,
        cronExpr: consolidation.cron,
        fn: () => daemon!.run().then(() => undefined),
        jitterMs,
      });
      registered = true;

      factories.chatService.addObserver(observer);

      active.set(mindId, { mindPath, dbPath, db, daemon, writer, observer });
    } catch (err) {
      // Unwind in reverse order — only what we successfully built. Each
      // step is wrapped to keep the original error as the surfaced one.
      if (registered) {
        try {
          factories.scheduler.unregister(mindId);
        } catch (releaseErr) {
          log.warn(`activate rollback: scheduler.unregister(${mindId}) failed`, releaseErr);
        }
      }
      // Observer is only added after register succeeded; no rollback needed
      // unless we move that step earlier in the future.
      if (daemon) {
        try {
          await daemon.close();
        } catch (closeErr) {
          log.warn(`activate rollback: daemon.close(${mindId}) failed`, closeErr);
        }
      }
      if (db) {
        try {
          db.close();
        } catch (closeErr) {
          log.warn(`activate rollback: db.close(${mindId}) failed`, closeErr);
        }
      }
      throw err;
    }
  }

  async function releaseMindInner(mindId: string): Promise<void> {
    const entry = active.get(mindId);
    if (!entry) return;
    // Drop the map entry FIRST so a teardown failure doesn't leave a
    // half-released mind that a subsequent `release` would try to tear
    // down again. The daemon and db have their own idempotent close
    // contracts; we surface failures via warn but never block.
    active.delete(mindId);

    try {
      factories.scheduler.unregister(mindId);
    } catch (err) {
      log.warn(`release: scheduler.unregister(${mindId}) failed`, err);
    }
    try {
      factories.chatService.removeObserver(entry.observer);
    } catch (err) {
      log.warn(`release: chatService.removeObserver(${mindId}) failed`, err);
    }
    try {
      await entry.daemon.close();
    } catch (err) {
      log.warn(`release: daemon.close(${mindId}) failed`, err);
    }
    try {
      entry.db.close();
    } catch (err) {
      log.warn(`release: db.close(${mindId}) failed`, err);
    }
  }

  async function close(): Promise<void> {
    if (closed) return;
    closed = true;
    // Snapshot keys so we don't mutate during iteration (releaseMind
    // deletes from `active`).
    const ids = Array.from(active.keys());
    for (const id of ids) {
      await releaseMind(id);
    }
  }

  return { activateMind, releaseMind, close, __debugGet };

  function __debugGet(mindId: string): {
    readonly daemon: DreamDaemon;
    readonly dbPath: string;
    readonly writer: DailyLogWriter;
  } | null {
    const entry = active.get(mindId);
    if (!entry) return null;
    return { daemon: entry.daemon, dbPath: entry.dbPath, writer: entry.writer };
  }
}

// Re-export the default loader so the composition root can pass it as
// `configReader` without an extra import.
export const defaultConfigReader = loadChamberMindConfig;

