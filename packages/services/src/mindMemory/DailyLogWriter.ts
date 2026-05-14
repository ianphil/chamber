/**
 * DailyLogWriter — appends completed-turn frames to
 * `<mindPath>/.working-memory/log.md` in the chamber-structured-log/v1 format
 * and rotates pre-existing unstructured logs out of the way on first touch.
 *
 * Phase 5 scope (locked by plan):
 *   - Append-only writer for structured turn frames.
 *   - First-call migration: any existing unstructured log.md is moved aside
 *     to `log.legacy.md` (or `log.legacy.<ISO-z>.md` on collision) before
 *     the writer seeds a fresh sentinel-prefixed log.
 *   - Per-instance mutex serializes concurrent appends so `Promise.all`
 *     fans-in produce non-interleaved frames.
 *   - Rotation uses `fs.rename` (atomic on a single filesystem) so a failed
 *     rotation leaves the original `log.md` byte-equal to its prior state.
 *   - Steady-state appends use `fsp.open(..., 'a')` + `handle.sync()`. Each
 *     frame is bounded by `perTurnMaxBytes` (well under PIPE_BUF), so the
 *     POSIX append is atomic in practice.
 *
 * Out of scope: TurnRecorder wiring (Phase 6), pruning after consolidation
 * (Phase 9), composer integration (Phase 12).
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { Logger } from '../logger';
import {
  STRUCTURED_LOG_SENTINEL,
  detectSentinel,
  serializeTurn,
  type CompletedTurn,
} from './StructuredLogFormat';

const WORKING_MEMORY_DIRNAME = '.working-memory';
const LOG_FILENAME = 'log.md';
const LEGACY_FILENAME = 'log.legacy.md';

export interface DailyLogWriterLogger {
  info(message: string): void;
}

export interface DailyLogWriterDeps {
  /** Override `fs.rename` — used by tests to simulate rotation failures. */
  rename?: (from: string, to: string) => Promise<void>;
  /** Override the default `Logger.create('DailyLogWriter')`. */
  logger?: DailyLogWriterLogger;
  /**
   * Called once per successful structured turn write, after the on-disk
   * write has fsync'd. Phase 11 wires this to
   * `dream-state.incrementTurnCount` so the activity gate in dream-gates
   * advances on real writes (not on SDK session start).
   *
   * If the hook throws (sync or async), the on-disk write is NOT rolled
   * back — the structured frame remains in `log.md` — but the rejection
   * propagates to the caller so the wiring layer can react.
   */
  onTurnRecorded?: (turn: CompletedTurn) => void | Promise<void>;
}

export interface DailyLogWriterOptions {
  readonly mindId: string;
  readonly mindPath: string;
  readonly deps?: DailyLogWriterDeps;
}

export interface DailyLogWriter {
  write(turn: CompletedTurn): Promise<void>;
  /**
   * Eager-migration entry point. Performs the rotation-and-seed half of
   * `write()` WITHOUT requiring a turn payload. Behaviour:
   *
   *   - log.md absent → no-op (no rotation, no seed).
   *   - log.md empty (0 bytes) → seed sentinel-only.
   *   - log.md sentinel-prefixed → no-op (already structured).
   *   - log.md unstructured → rotate to log.legacy.md (or timestamped on
   *     collision) and seed `SENTINEL + '\n\n'` byte-for-byte matching
   *     `MindScaffold.createStructure`.
   *
   * Serializes through the same per-instance chain as `write()` so a
   * concurrent `migrateIfNeeded` + `write` pair never produces a doubled
   * sentinel or half-rotated state.
   */
  migrateIfNeeded(): Promise<void>;
  /**
   * Drain the per-instance write chain. Resolves only after every queued
   * `write()` / `migrateIfNeeded()` settles (success OR failure). Phase 4
   * `rollbackToUnstructured` calls this after detaching the observer so it
   * can read back log.md without missing in-flight frames.
   *
   * Errors from queued operations are surfaced through their original
   * promises (write returns a rejecting Promise). `flush()` itself never
   * rejects — its job is purely to wait for quiescence.
   */
  flush(): Promise<void>;
}

export function createDailyLogWriter(opts: DailyLogWriterOptions): DailyLogWriter {
  const { mindId, mindPath } = opts;
  const log: DailyLogWriterLogger = opts.deps?.logger ?? Logger.create('DailyLogWriter');
  const rename = opts.deps?.rename ?? fsp.rename;
  const onTurnRecorded = opts.deps?.onTurnRecorded;

  const workingMemoryDir = path.resolve(mindPath, WORKING_MEMORY_DIRNAME);
  const logPath = path.join(workingMemoryDir, LOG_FILENAME);
  const legacyPath = path.join(workingMemoryDir, LEGACY_FILENAME);

  // Per-instance mutex chain. Every write awaits the prior link before issuing
  // its own read-modify-write cycle, eliminating intra-process interleaving.
  let chain: Promise<void> = Promise.resolve();

  async function readOrNull(absPath: string): Promise<string | null> {
    try {
      return await fsp.readFile(absPath, 'utf-8');
    } catch (err) {
      if (isErrnoCode(err, 'ENOENT')) return null;
      throw err;
    }
  }

  async function existsPath(absPath: string): Promise<boolean> {
    try {
      await fsp.access(absPath, fs.constants.F_OK);
      return true;
    } catch (err) {
      if (isErrnoCode(err, 'ENOENT')) return false;
      throw err;
    }
  }

  async function rotate(currentContent: string): Promise<void> {
    let target = legacyPath;
    let targetName = LEGACY_FILENAME;
    if (await existsPath(legacyPath)) {
      targetName = `log.legacy.${isoStamp()}.md`;
      target = path.join(workingMemoryDir, targetName);
    }

    // `rename` is atomic on a single filesystem: either log.md is at its old
    // path (failure) or at the target path (success). On failure we surface
    // the error to the caller; the file content is unchanged. We deliberately
    // do NOT fall back to copy+unlink, which would risk a half-rotated state.
    await rename(logPath, target);

    log.info(`Rotated unstructured log.md to ${targetName} for mind ${mindId}`);

    // Sanity check: rotation succeeded, so `currentContent` is now under
    // `target`. We don't re-read here — the migration is complete and the
    // seed step below creates a fresh log.md.
    void currentContent;
  }

  async function seedFreshLog(turn: CompletedTurn | null): Promise<void> {
    // INVARIANT: when turn is null (eager migration via migrateIfNeeded),
    // the seed bytes MUST exactly match MindScaffold.createStructure
    // (`SENTINEL + '\n\n'`) so on-disk content is uniform regardless of
    // which path created it. Composer + parseLog tolerate trailing blank
    // lines, but the byte-for-byte parity is what makes the migration
    // path reversible.
    const content = turn === null
      ? `${STRUCTURED_LOG_SENTINEL}\n\n`
      : `${STRUCTURED_LOG_SENTINEL}\n\n${serializeTurn(turn)}`;
    // Atomic write so a partial seed never lands on disk.
    const tmp = `${logPath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
    const handle = await fsp.open(tmp, 'wx');
    try {
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await fsp.rename(tmp, logPath);
    } catch (err) {
      try {
        await fsp.unlink(tmp);
      } catch {
        // best-effort cleanup
      }
      throw err;
    }
  }

  async function appendFrame(turn: CompletedTurn): Promise<void> {
    const handle = await fsp.open(logPath, 'a');
    try {
      await handle.write(serializeTurn(turn));
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async function doWrite(turn: CompletedTurn): Promise<void> {
    await fsp.mkdir(workingMemoryDir, { recursive: true });

    const existing = await readOrNull(logPath);

    // No file → seed a fresh structured log; no rotation event.
    if (existing === null) {
      await seedFreshLog(turn);
      return;
    }

    // Empty file is treated as already-structured (no rotation needed):
    // we seed sentinel + frame in place. The atomic write replaces the
    // empty file in one rename.
    if (existing.length === 0) {
      await seedFreshLog(turn);
      return;
    }

    if (detectSentinel(existing)) {
      await appendFrame(turn);
      return;
    }

    // Unstructured content present — rotate before seeding. If rotation
    // fails the original log.md is left intact and the error propagates.
    await rotate(existing);
    await seedFreshLog(turn);
  }

  async function doMigrateIfNeeded(): Promise<void> {
    // Eager-migration variant of doWrite. Same rotation rules, but the seed
    // is sentinel-only (no turn frame). Idempotent: missing or already-
    // structured logs are no-ops. Reused by MindMemoryService.activateMind
    // so a user who flips the dream-daemon switch sees their pre-existing
    // unstructured log preserved as log.legacy.md immediately, without
    // waiting for the next chat turn.
    await fsp.mkdir(workingMemoryDir, { recursive: true });

    const existing = await readOrNull(logPath);

    // No log.md → no-op. The first write() will seed.
    if (existing === null) return;

    // Empty file → seed sentinel-only so subsequent reads see a valid log.
    if (existing.length === 0) {
      await seedFreshLog(null);
      return;
    }

    // Already structured → idempotent no-op.
    if (detectSentinel(existing)) return;

    // Unstructured → rotate, then seed sentinel-only.
    await rotate(existing);
    await seedFreshLog(null);
  }

  function write(turn: CompletedTurn): Promise<void> {
    const next = chain.then(async () => {
      await doWrite(turn);
      if (onTurnRecorded) {
        await onTurnRecorded(turn);
      }
    });
    // Swallow rejections on the chain itself so a failed write does not
    // poison the queue for subsequent callers; the rejection still reaches
    // the caller via `next`.
    chain = next.catch(() => undefined);
    return next;
  }

  function migrateIfNeeded(): Promise<void> {
    const next = chain.then(() => doMigrateIfNeeded());
    chain = next.catch(() => undefined);
    return next;
  }

  function flush(): Promise<void> {
    // Wait for the current chain tail to settle. The chain itself swallows
    // rejections, so awaiting it never throws — flush is purely a quiescence
    // barrier. Callers who care about per-write errors observe them via the
    // promises returned by `write()` / `migrateIfNeeded()`.
    return chain.then(() => undefined);
  }

  return { write, migrateIfNeeded, flush };
}

function isoStamp(): string {
  // 2026-05-12T17:21:45.123Z → 2026-05-12T17-21-45Z
  return new Date().toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-');
}

function isErrnoCode(err: unknown, code: string): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as NodeJS.ErrnoException).code === code
  );
}
