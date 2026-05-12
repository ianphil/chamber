/**
 * DreamDaemon — per-mind background memory consolidation orchestrator.
 *
 * Composes the Phase 1-8 modules into the canonical cycle:
 *
 *   1. Gate check (lock + activity + time)
 *   2. Acquire lock (in-process mutex layered with DB lock)
 *   3. Snapshot turns from log.md UP TO the cutoff (last turn id at
 *      snapshot time) — anything appended later survives the prune
 *   4. Drive `llmClient.synthesize` to extract memorable items from the
 *      snapshot
 *   5. Run the four-phase consolidation pipeline
 *   6. Atomically write `memory.md` capped at `memoryMaxBytes`
 *   7. Re-read log.md, prune ONLY the snapshot turn ids, write back
 *   8. Archive each consolidated source turn
 *   9. Tiered weekly / monthly rollups when archive thresholds are met
 *  10. Record the run, advance state, release the lock
 *
 * Critical correctness rules (enforced by tests):
 *   - Mid-run append must NOT lose turns (re-read before prune).
 *   - Errors during the cycle MUST release the lock in `finally`.
 *   - `forceRun` bypasses gates but NOT the lock.
 *   - Lock skip vs gate skip vs no-turns are distinguishable in the
 *     returned `DreamRunResult`.
 *   - All vault/archive/db are injected; tests use real tmp dirs +
 *     in-memory sqlite + the `__fakes__/FakeLLMClient`.
 */

import type Database from 'better-sqlite3';

import type { CompletedTurn } from '@chamber/shared/turn-observer';

import { Logger } from '../logger';
import { runConsolidation } from './consolidation';
import {
  __resetMindMutexForTesting,
  withMindMutex,
} from './consolidation-scheduler';
import { evaluateGates } from './dream-gates';
import {
  acquireLock,
  buildLockHolder,
  getLock,
  markPhaseComplete,
  recordRun,
  releaseLock,
  resetActivityCounter,
  readState,
  setLastConsolidatedTurnId,
} from './dream-state';
import { extractFromLog } from './extraction';
import type { LLMClient } from './LLMClient';
import type { MindArchiveStore } from './MindArchiveStore';
import type { MindMemoryVault } from './MindMemoryVault';
import {
  parseLog,
  serializeTurn,
  STRUCTURED_LOG_SENTINEL,
  type ParsedTurn,
} from './StructuredLogFormat';

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export type DreamDaemonPhase =
  | 'idle'
  | 'gating'
  | 'snapshot'
  | 'extracting'
  | 'consolidating'
  | 'writing'
  | 'pruning'
  | 'archiving'
  | 'rolling-up'
  | 'recording';

export type DreamSkipReason = 'no-activity' | 'too-soon' | 'locked' | 'no-turns';

export type DreamRunResult =
  | {
      readonly status: 'success';
      readonly extractedCount: number;
      readonly consolidatedCount: number;
      readonly archivedCount: number;
      readonly fromTurnId: string | null;
      readonly toTurnId: string;
      readonly weeklyArchived: boolean;
      readonly monthlyArchived: boolean;
    }
  | { readonly status: 'skipped'; readonly reason: DreamSkipReason }
  | { readonly status: 'failed'; readonly reason: string; readonly phase: DreamDaemonPhase };

export interface DreamStatus {
  readonly phase: DreamDaemonPhase;
  readonly locked: boolean;
  readonly lastRunAt: number | null;
  readonly lastResult: DreamRunResult | null;
}

export interface DreamDaemonConfig {
  readonly memoryMaxBytes: number;
  readonly llmTimeoutMs: number;
  readonly lockTtlMs: number;
  readonly minTurnsBetweenRuns: number;
  readonly minDailyIntervalMs: number;
  readonly weeklyRollupAfterDailies: number;
  readonly monthlyRollupAfterWeeklies: number;
  readonly weeklyMinIntervalMs: number;
  readonly monthlyMinIntervalMs: number;
}

export interface DreamDaemonOptions {
  readonly mindId: string;
  readonly mindPath: string;
  readonly llmClient: LLMClient;
  readonly vault: MindMemoryVault;
  readonly archiveStore: MindArchiveStore;
  readonly db: Database.Database;
  readonly config: DreamDaemonConfig;
  readonly clock?: () => Date;
  readonly logger?: Logger;
}

export interface DreamDaemon {
  run(): Promise<DreamRunResult>;
  forceRun(): Promise<DreamRunResult>;
  getStatus(): DreamStatus;
  notifyTurnCompleted(turn: CompletedTurn): void;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const LOG_REL_PATH = 'log.md';
const MEMORY_REL_PATH = 'memory.md';

export function createDreamDaemon(opts: DreamDaemonOptions): DreamDaemon {
  const {
    mindId,
    llmClient,
    vault,
    archiveStore,
    db,
    config,
  } = opts;
  const clock = opts.clock ?? (() => new Date());
  const logger = opts.logger ?? Logger.create(`DreamDaemon[${mindId}]`);

  let phase: DreamDaemonPhase = 'idle';
  let lastRunAt: number | null = null;
  let lastResult: DreamRunResult | null = null;
  let closed = false;

  function getStatus(): DreamStatus {
    return {
      phase,
      locked: phase !== 'idle',
      lastRunAt,
      lastResult,
    };
  }

  function setLastResult(result: DreamRunResult): DreamRunResult {
    lastResult = result;
    return result;
  }

  async function run(): Promise<DreamRunResult> {
    return executeCycle({ bypassGates: false });
  }

  async function forceRun(): Promise<DreamRunResult> {
    return executeCycle({ bypassGates: true });
  }

  async function executeCycle(args: {
    readonly bypassGates: boolean;
  }): Promise<DreamRunResult> {
    if (closed) {
      return setLastResult({
        status: 'failed',
        reason: 'daemon closed',
        phase: 'idle',
      });
    }

    const now = clock().getTime();

    // Gate phase — only when not forced. The lock gate ALWAYS runs (force
    // bypasses activity + time, never the lock).
    phase = 'gating';
    const lockHeld = isLockHeld(now);
    if (lockHeld) {
      phase = 'idle';
      return setLastResult({ status: 'skipped', reason: 'locked' });
    }

    if (!args.bypassGates) {
      const gate = evaluateGates(
        {
          phase: 'daily',
          state: readState(db),
          now,
          lockHeld: false,
        },
        {
          minTurnsBetweenRuns: config.minTurnsBetweenRuns,
          minIntervalMs: config.minDailyIntervalMs,
        },
      );
      if (!gate.run) {
        phase = 'idle';
        // `evaluateGates` only returns 'locked' when lockHeld=true, which we
        // already handled above; the remaining reasons map 1:1 to skip.
        if (gate.reason === 'ready' || gate.reason === 'locked') {
          phase = 'idle';
          return setLastResult({ status: 'skipped', reason: 'locked' });
        }
        return setLastResult({ status: 'skipped', reason: gate.reason });
      }
    }

    // Try the in-process mutex first. Fail-fast on a concurrent caller so
    // the second `run()` returns `locked` instead of queuing.
    const mutexResult = await withMindMutex(mindId, async () => {
      return runUnderLock(now);
    });

    if (!mutexResult.acquired) {
      phase = 'idle';
      return setLastResult({ status: 'skipped', reason: 'locked' });
    }

    return mutexResult.value;
  }

  function isLockHeld(now: number): boolean {
    const existing = getLock(db, 'daily');
    if (existing === null) return false;
    return existing.expiresAt > now;
  }

  async function runUnderLock(now: number): Promise<DreamRunResult> {
    // Step 2 — acquire DB lock.
    const lockHolder = buildLockHolder(mindId);
    const lockResult = acquireLock(db, {
      phase: 'daily',
      mindId,
      uuid: extractHolderUuid(lockHolder),
      now,
      ttlMs: config.lockTtlMs,
    });

    if (!lockResult.acquired) {
      phase = 'idle';
      return setLastResult({ status: 'skipped', reason: 'locked' });
    }

    // From here on, the DB lock MUST be released no matter what.
    let releasedByUs = false;
    const acquiredHolder = lockResult.holder ?? lockHolder;

    try {
      const cycleResult = await runCycleLocked(now);
      lastRunAt = clock().getTime();
      return setLastResult(cycleResult);
    } catch (err) {
      logger.error('cycle threw', err);
      phase = 'idle';
      lastRunAt = clock().getTime();
      const reason = err instanceof Error ? err.message : String(err);
      // Record the failure even on unexpected throws so operators have a
      // trail in dream_runs.
      try {
        recordRun(db, {
          phase: 'daily',
          startedAt: now,
          endedAt: clock().getTime(),
          status: 'failed',
          reason,
        });
      } catch (recordErr) {
        logger.error('failed to record cycle failure', recordErr);
      }
      return setLastResult({ status: 'failed', reason, phase });
    } finally {
      try {
        releaseLock(db, 'daily', acquiredHolder);
        releasedByUs = true;
      } catch (releaseErr) {
        logger.error('failed to release lock', releaseErr);
      }
      if (!releasedByUs) {
        // Best-effort: if the typed release threw, attempt a direct delete
        // so we never wedge the daemon. Swallow nested errors — the lock
        // will be stolen on its TTL anyway.
        try {
          db.prepare(
            'DELETE FROM dream_locks WHERE phase = ? AND holder = ?',
          ).run('daily', acquiredHolder);
        } catch {
          /* ignore */
        }
      }
      phase = 'idle';
    }
  }

  async function runCycleLocked(now: number): Promise<DreamRunResult> {
    // Step 3 — snapshot turns from log.md.
    phase = 'snapshot';
    const snapshot = await readSnapshot();
    const cutoffIndex = findCutoffIndex(snapshot.turns, snapshot.lastConsolidated);
    const inScopeSnapshot = snapshot.turns.slice(cutoffIndex);
    const consolidatedIds = new Set(inScopeSnapshot.map((t) => t.turnId));

    if (inScopeSnapshot.length === 0) {
      recordRun(db, {
        phase: 'daily',
        startedAt: now,
        endedAt: clock().getTime(),
        status: 'skipped',
        reason: 'no-turns',
      });
      return { status: 'skipped', reason: 'no-turns' };
    }

    // Step 4 — extract via LLM.
    phase = 'extracting';
    const prompt = buildSynthesisPrompt(inScopeSnapshot);
    const llmResponse = await llmClient.synthesize({
      prompt,
      timeoutMs: config.llmTimeoutMs,
    });
    const referenceDate = new Date(now);
    const isoDate = referenceDate.toISOString().slice(0, 10);
    const newEntries = extractFromLog(llmResponse, isoDate);

    // Step 5 — consolidate.
    phase = 'consolidating';
    const currentMemoryMd = (await vault.read(MEMORY_REL_PATH)) ?? '';
    const consolidation = runConsolidation({
      currentMemoryMd,
      newEntries,
      referenceDate,
    });
    const memoryMd = capBytes(consolidation.memoryMd, config.memoryMaxBytes);

    // Step 6 — atomic write of memory.md.
    phase = 'writing';
    await vault.write(MEMORY_REL_PATH, memoryMd);

    // Step 7 — re-read log.md and prune only the snapshot turn ids. Tail
    // entries appended during the LLM call MUST survive.
    phase = 'pruning';
    await prunePersistedLog(consolidatedIds);

    // Step 8 — archive each consolidated source turn.
    phase = 'archiving';
    for (const turn of inScopeSnapshot) {
      await archiveStore.writeConsolidated({
        turnId: turn.turnId,
        timestamp: turn.timestamp,
        content: serializeTurn({
          turnId: turn.turnId,
          sessionId: turn.sessionId,
          model: turn.model,
          status: turn.status,
          startedAt: turn.timestamp,
          endedAt: turn.timestamp,
          prompt: turn.prompt,
          finalAssistantMessage: turn.assistant,
        }),
      });
    }

    // Step 9 — tiered rollups.
    phase = 'rolling-up';
    const weeklyArchived = await maybeRollupWeekly(now);
    const monthlyArchived = await maybeRollupMonthly(now);

    // Step 10 — record run + advance state.
    phase = 'recording';
    const lastTurnId = inScopeSnapshot[inScopeSnapshot.length - 1]!.turnId;
    setLastConsolidatedTurnId(db, lastTurnId);
    resetActivityCounter(db);
    markPhaseComplete(db, 'daily', now);
    recordRun(db, {
      phase: 'daily',
      startedAt: now,
      endedAt: clock().getTime(),
      status: 'success',
      fromTurnId: snapshot.lastConsolidated,
      toTurnId: lastTurnId,
    });

    return {
      status: 'success',
      extractedCount: newEntries.length,
      consolidatedCount: consolidation.entriesKept,
      archivedCount: inScopeSnapshot.length,
      fromTurnId: snapshot.lastConsolidated,
      toTurnId: lastTurnId,
      weeklyArchived,
      monthlyArchived,
    };
  }

  async function readSnapshot(): Promise<{
    readonly turns: readonly ParsedTurn[];
    readonly lastConsolidated: string | null;
  }> {
    const content = (await vault.read(LOG_REL_PATH)) ?? '';
    const parsed = parseLog(content);
    const state = readState(db);
    return {
      turns: parsed.turns,
      lastConsolidated: state.lastConsolidatedTurnId,
    };
  }

  function findCutoffIndex(
    turns: readonly ParsedTurn[],
    lastConsolidated: string | null,
  ): number {
    if (lastConsolidated === null) return 0;
    const idx = turns.findIndex((t) => t.turnId === lastConsolidated);
    if (idx === -1) return 0;
    return idx + 1;
  }

  async function prunePersistedLog(consolidatedIds: Set<string>): Promise<void> {
    const content = (await vault.read(LOG_REL_PATH)) ?? '';
    const parsed = parseLog(content);
    const survivors = parsed.turns.filter((t) => !consolidatedIds.has(t.turnId));
    const body = survivors
      .map((t) =>
        serializeTurn({
          turnId: t.turnId,
          sessionId: t.sessionId,
          model: t.model,
          status: t.status,
          startedAt: t.timestamp,
          endedAt: t.timestamp,
          prompt: t.prompt,
          finalAssistantMessage: t.assistant,
        }),
      )
      .join('');
    const next = `${STRUCTURED_LOG_SENTINEL}\n\n${body}`;
    await vault.write(LOG_REL_PATH, next);
  }

  async function maybeRollupWeekly(now: number): Promise<boolean> {
    const dailies = await archiveStore.listConsolidated();
    if (dailies.length < config.weeklyRollupAfterDailies) return false;
    const state = readState(db);
    if (
      state.lastWeeklyAt !== null &&
      now - state.lastWeeklyAt < config.weeklyMinIntervalMs
    ) {
      return false;
    }
    const weekKey = isoWeekKey(new Date(now));
    const summary = `# Weekly Rollup ${weekKey}\n\n${dailies
      .slice(-config.weeklyRollupAfterDailies)
      .map((name) => `- ${name}`)
      .join('\n')}\n`;
    await archiveStore.writeWeekly(weekKey, summary);
    markPhaseComplete(db, 'weekly', now);
    return true;
  }

  async function maybeRollupMonthly(now: number): Promise<boolean> {
    const weeklies = await archiveStore.listWeekly();
    if (weeklies.length < config.monthlyRollupAfterWeeklies) return false;
    const state = readState(db);
    if (
      state.lastMonthlyAt !== null &&
      now - state.lastMonthlyAt < config.monthlyMinIntervalMs
    ) {
      return false;
    }
    const monthKey = isoMonthKey(new Date(now));
    const summary = `# Monthly Rollup ${monthKey}\n\n${weeklies
      .slice(-config.monthlyRollupAfterWeeklies)
      .map((name) => `- ${name}`)
      .join('\n')}\n`;
    await archiveStore.writeMonthly(monthKey, summary);
    markPhaseComplete(db, 'monthly', now);
    return true;
  }

  function notifyTurnCompleted(_turn: CompletedTurn): void {
    // No-op by design: DailyLogWriter increments the activity counter in
    // its own `onTurnRecorded` path so the daemon does not need to. Kept
    // on the public surface so the InternalScheduler (Phase 10) can wire
    // turn observers without branching.
    void _turn;
  }

  async function close(): Promise<void> {
    closed = true;
    // Drop any in-process mutex this daemon may hold so a fresh daemon
    // (e.g., after a restart in tests) can re-enter cleanly.
    __resetMindMutexForTesting();
  }

  return {
    run,
    forceRun,
    getStatus,
    notifyTurnCompleted,
    close,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSynthesisPrompt(turns: readonly ParsedTurn[]): string {
  const lines: string[] = [];
  lines.push(
    'Extract memorable items (preferences, decisions, prohibitions, references) from the following completed turns.',
  );
  lines.push(
    'Respond using daily-log format: each item on a "## HH:MM:SS" header line followed by lines of "**[type]** content".',
  );
  lines.push('');
  for (const t of turns) {
    const time = t.timestamp.slice(11, 19);
    lines.push(`## ${time}`);
    lines.push(`**[user-prompt]** ${oneLine(t.prompt)}`);
    lines.push(`**[assistant]** ${oneLine(t.assistant)}`);
    lines.push('');
  }
  return lines.join('\n');
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function capBytes(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf-8') <= maxBytes) return text;
  // Trim from the tail until the encoded length fits. We avoid mid-codepoint
  // truncation by stepping one character at a time.
  let truncated = text;
  while (Buffer.byteLength(truncated, 'utf-8') > maxBytes && truncated.length > 0) {
    truncated = truncated.slice(0, -1);
  }
  return truncated;
}

function extractHolderUuid(holder: string): string {
  // holder is "dream-daemon:<mindId>:<pid>:<uuid>". The uuid is the last
  // colon-delimited field.
  const idx = holder.lastIndexOf(':');
  return idx === -1 ? holder : holder.slice(idx + 1);
}

function isoWeekKey(date: Date): string {
  // Compute ISO 8601 week date (YYYY-Www) — Monday starts the week and the
  // first week of the year contains January 4.
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((target.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${target.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function isoMonthKey(date: Date): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}
