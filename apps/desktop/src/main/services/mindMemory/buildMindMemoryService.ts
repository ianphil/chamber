/**
 * Phase 13 desktop wiring for the per-mind background memory engine
 * ("Dream Daemon"). This module is a *thin adapter*: it knows how to
 *
 *   - open per-mind `dream.db` files at the canonical path using a
 *     better-sqlite3 constructor injected by the composition root (which
 *     resolves the runtime via the shared `chamber-sqlite-runtime` path),
 *   - mint *one-shot* Copilot sessions with tools disabled and a refusing
 *     permission handler (defense-in-depth — tools=[] should already mean
 *     no permission requests reach the handler),
 *   - construct a `DreamDaemon` from a `WorkingMemoryConsolidationConfig`
 *     by supplying defaults for the wider `DreamDaemonConfig` surface.
 *
 * The composition root in `apps/desktop/src/main.ts` calls
 * `buildMindMemoryService` once and wires the resulting service into
 * `MindManager`'s `mind:loaded` / `mind:unloaded` events.
 */
import path from 'node:path';
import fs from 'node:fs';
import {
  buildOneShotSession,
  createMindMemoryService,
  createInternalScheduler,
  createMindMemoryVault,
  createMindArchiveStore,
  createDreamDaemon,
  createCopilotLLMClient,
  defaultConfigReader,
  Logger,
  migrate as migrateDreamDb,
  type MindMemoryService,
  type MindManager,
  type DaemonFactoryOptions,
  type CreateOneShotSessionArgs,
  type OneShotSession,
} from '@chamber/services';
import type { TurnCompletionObserver } from '@chamber/shared';

type BetterSqlite3Module = typeof import('better-sqlite3');
type BetterSqlite3Database = import('better-sqlite3').Database;

interface BuildMindMemoryServiceOptions {
  readonly mindManager: MindManager;
  readonly chatService: {
    addObserver(o: TurnCompletionObserver): void;
    removeObserver(o: TurnCompletionObserver): void;
  };
  /**
   * better-sqlite3 module already resolved by the composition root. Master
   * resolves this once via `loadBetterSqlite3()` in `apps/desktop/src/main.ts`
   * and feeds the same module into both the task ledger (`setSqliteDatabase`)
   * and the dream daemon, so packaged builds use the unified
   * `chamber-sqlite-runtime` rather than an ASAR-unpacked node_modules copy.
   */
  readonly Database: BetterSqlite3Module;
  readonly logger?: Logger;
}

export interface MindMemoryComposition {
  readonly service: MindMemoryService;
  readonly scheduler: ReturnType<typeof createInternalScheduler>;
  /**
   * Shut everything down cleanly. Releases the service first (which releases
   * each mind, closing its observer + dream.db handle), then the scheduler.
   * Idempotent.
   */
  close(): Promise<void>;
}

/**
 * Build the createOneShotSession adapter for CopilotLLMClient. Each
 * synthesize call mints a fresh CopilotSession scoped to the mind's
 * working directory, with NO tools, NO config discovery, and a refusing
 * permission handler. The session is closed in the LLMClient's `finally`.
 *
 * The SDK-touching plumbing lives in `@chamber/services` `buildOneShotSession`
 * so the same contract is exercised by the live-SDK integration test.
 */
function makeCreateOneShotSession(
  mindManager: MindManager,
  logger: Logger,
): (args: CreateOneShotSessionArgs) => Promise<OneShotSession> {
  return async ({ mindId, mindPath, signal }) => {
    const ctx = mindManager.getMind(mindId);
    if (!ctx) {
      throw new Error(`MindMemory: cannot create session — mind ${mindId} is not loaded`);
    }
    return buildOneShotSession({
      client: ctx.client,
      workingDirectory: mindPath,
      signal,
      onDisconnectError: (err) =>
        logger.warn('mindMemory: session disconnect failed', { err: String(err) }),
    });
  };
}

// Defaults for the wider DreamDaemonConfig fields that aren't covered by
// WorkingMemoryConsolidationConfig. Tuned to match Phase 9/10 unit-test
// defaults so production behavior matches the test harness.
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_LLM_TIMEOUT_MS = 90_000;
const DEFAULT_LOCK_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MIN_TURNS_BETWEEN_RUNS = 1;
const DEFAULT_MIN_DAILY_INTERVAL_MS = 0;
const DEFAULT_WEEKLY_ROLLUP_AFTER_DAILIES = 7;
const DEFAULT_MONTHLY_ROLLUP_AFTER_WEEKLIES = 4;
const DEFAULT_WEEKLY_MIN_INTERVAL_MS = 7 * MS_PER_DAY;
const DEFAULT_MONTHLY_MIN_INTERVAL_MS = 30 * MS_PER_DAY;

export function buildMindMemoryService(opts: BuildMindMemoryServiceOptions): MindMemoryComposition {
  const logger = opts.logger ?? Logger.create('mindMemory');
  const Database = opts.Database;
  const scheduler = createInternalScheduler({ logger });
  const createOneShotSession = makeCreateOneShotSession(opts.mindManager, logger);

  const service = createMindMemoryService({
    scheduler,
    chatService: opts.chatService,
    configReader: defaultConfigReader,
    dbFactory: (dbPath: string): BetterSqlite3Database => {
      // INVARIANT: must apply the dream.db schema before returning. Without
      // `migrate(db)`, the daemon's first call to `readState` / `acquireLock`
      // would throw `no such table: dream_state`. Mirrors `openDreamDb` in
      // dream-schema.ts, but uses the dynamically-loaded better-sqlite3
      // module so packaged builds resolve the unpacked native binding.
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      const db = new Database(dbPath);
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');
      migrateDreamDb(db);
      return db;
    },
    vaultFactory: createMindMemoryVault,
    archiveFactory: createMindArchiveStore,
    daemonFactory: ({ mindId, mindPath, vault, archive, db, config }: DaemonFactoryOptions) => {
      const llmClient = createCopilotLLMClient({
        mindId,
        mindPath,
        deps: { createOneShotSession },
      });
      return createDreamDaemon({
        mindId,
        mindPath,
        llmClient,
        vault,
        archiveStore: archive,
        db,
        config: {
          memoryMaxBytes: config.memoryMaxBytes,
          llmTimeoutMs: DEFAULT_LLM_TIMEOUT_MS,
          lockTtlMs: DEFAULT_LOCK_TTL_MS,
          minTurnsBetweenRuns: DEFAULT_MIN_TURNS_BETWEEN_RUNS,
          minDailyIntervalMs: DEFAULT_MIN_DAILY_INTERVAL_MS,
          weeklyRollupAfterDailies: DEFAULT_WEEKLY_ROLLUP_AFTER_DAILIES,
          monthlyRollupAfterWeeklies: DEFAULT_MONTHLY_ROLLUP_AFTER_WEEKLIES,
          weeklyMinIntervalMs: DEFAULT_WEEKLY_MIN_INTERVAL_MS,
          monthlyMinIntervalMs: DEFAULT_MONTHLY_MIN_INTERVAL_MS,
        },
        logger,
      });
    },
    logger,
  });

  let closed = false;
  return {
    service,
    scheduler,
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      // INVARIANT: release the service BEFORE closing the scheduler so the
      // scheduler can still observe `unregister` calls coming from each
      // mind release. Otherwise close() on a closed scheduler would throw.
      try {
        await service.close();
      } catch (err) {
        logger.warn('mindMemory: service close failed', { err: String(err) });
      }
      try {
        scheduler.close();
      } catch (err) {
        logger.warn('mindMemory: scheduler close failed', { err: String(err) });
      }
    },
  };
}
