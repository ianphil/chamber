/**
 * InternalScheduler — Phase 10 of Dream Daemon.
 *
 * A per-mind in-process croner job runner that drives DreamDaemon.run() on a
 * configurable cadence. Deliberately NOT registered with the user-facing
 * CronService — `mind-memory.consolidate` is invisible to the user's cron
 * list by design (keeps the surfaced cron table clean).
 *
 * Three correctness invariants:
 *
 *   1. Re-registering the same mindId atomically replaces the previous Cron
 *      (stop the old one before swapping in the new one).
 *
 *   2. One in-flight invocation per mind. Both cron-driven ticks AND
 *      `runNow` calls share the same per-mind in-flight promise. A
 *      re-entrant tick or a parallel `runNow` while a previous run is
 *      still executing receives the existing promise rather than starting
 *      a second concurrent invocation. This complements (and pre-empts)
 *      the per-mind mutex inside DreamDaemon.
 *
 *   3. Errors thrown by `fn` MUST NOT propagate across the croner
 *      boundary — uncaught throws inside croner silently kill the
 *      schedule. Wrap and log instead.
 *
 * Jitter: when many minds activate simultaneously (e.g. on app start at
 * 03:00 with N minds all configured for daily 03:00 consolidation) we
 * stagger their first fires by a uniform random delay so they don't all
 * hit the LLM in the same second. The random source is injectable so
 * tests are deterministic.
 */

import { Cron } from 'croner';
import { Logger } from '../logger';

export interface InternalSchedulerOptions {
  readonly logger?: Logger;
  /** Defaults to `Math.random()`. Inject for deterministic jitter in tests. */
  readonly random?: () => number;
}

export interface RegisterOptions {
  readonly mindId: string;
  readonly cronExpr: string;
  readonly fn: () => Promise<void>;
  /**
   * Optional uniform random delay (in ms) added before each fire to
   * prevent thundering-herd when many minds activate simultaneously.
   * The actual delay is `random() * jitterMs`.
   */
  readonly jitterMs?: number;
}

export interface InternalScheduler {
  /**
   * Register a mind's consolidation cron. Replaces any existing entry for
   * the same mindId. Cron parses via `croner` — invalid expressions throw
   * synchronously. Throws if the scheduler has been closed.
   */
  register(opts: RegisterOptions): void;

  /** Stop and forget the entry. No-op if not registered. */
  unregister(mindId: string): void;

  /**
   * Fire the registered fn immediately, OUT OF BAND of the cron schedule.
   * If a previous invocation (cron-driven or runNow) is still executing,
   * returns the in-flight promise so all callers observe the same outcome.
   * Throws if the mindId is not registered.
   */
  runNow(mindId: string): Promise<void>;

  /** Returns the registered cron expressions keyed by mindId. */
  list(): ReadonlyMap<string, string>;

  /** Stop every job and clear the registry. Idempotent. */
  close(): void;
}

interface Entry {
  readonly cronExpr: string;
  readonly fn: () => Promise<void>;
  readonly cron: Cron;
  inFlight: Promise<void> | null;
}

export function createInternalScheduler(
  opts: InternalSchedulerOptions = {},
): InternalScheduler {
  const log = opts.logger ?? Logger.create('InternalScheduler');
  const random = opts.random ?? Math.random;
  const entries = new Map<string, Entry>();
  let closed = false;

  function invokeGuarded(mindId: string, entry: Entry): Promise<void> {
    if (entry.inFlight !== null) {
      return entry.inFlight;
    }
    const promise = (async () => {
      try {
        await entry.fn();
      } catch (err) {
        log.error(`consolidation fn threw for mind ${mindId}:`, err);
      }
    })();
    entry.inFlight = promise.finally(() => {
      entry.inFlight = null;
    });
    return entry.inFlight;
  }

  function stopEntry(entry: Entry): void {
    try {
      entry.cron.stop();
    } catch (err) {
      // croner.stop() is documented as safe to call repeatedly, but if it
      // ever throws (e.g. during shutdown races) we don't want to leak it
      // out of close()/unregister() and break callers.
      log.warn('failed to stop cron:', err);
    }
  }

  return {
    register({ mindId, cronExpr, fn, jitterMs }: RegisterOptions): void {
      if (closed) {
        throw new Error('InternalScheduler is closed');
      }

      // Stop and remove the previous entry BEFORE constructing the new
      // Cron so a parse error on the new expression doesn't leave the
      // mind un-scheduled silently — it just leaves the previous schedule
      // in place. Wait — actually we DO want replacement semantics:
      // remove first so register() with an invalid cron makes it obvious
      // the mind has no schedule. Croner throws synchronously on a bad
      // expression below, which propagates to the caller.
      const previous = entries.get(mindId);
      if (previous) {
        stopEntry(previous);
        entries.delete(mindId);
      }

      // Construct the Cron. Invalid expressions throw synchronously here;
      // we let the error propagate to the caller. `protect: true` is a
      // belt-and-braces measure that prevents croner from launching a
      // second handler if the first hasn't returned — our own in-flight
      // guard is the source of truth, but `protect` keeps croner's own
      // bookkeeping consistent.
      const cron = new Cron(
        cronExpr,
        { protect: true },
        async () => {
          const current = entries.get(mindId);
          if (!current) return;
          if (jitterMs !== undefined && jitterMs > 0) {
            const delay = Math.floor(random() * jitterMs);
            if (delay > 0) {
              await new Promise<void>((resolve) => setTimeout(resolve, delay));
            }
          }
          await invokeGuarded(mindId, current);
        },
      );

      entries.set(mindId, { cronExpr, fn, cron, inFlight: null });
    },

    unregister(mindId: string): void {
      const entry = entries.get(mindId);
      if (!entry) return;
      stopEntry(entry);
      entries.delete(mindId);
    },

    async runNow(mindId: string): Promise<void> {
      const entry = entries.get(mindId);
      if (!entry) {
        throw new Error(`Mind ${mindId} is not registered with InternalScheduler`);
      }
      return invokeGuarded(mindId, entry);
    },

    list(): ReadonlyMap<string, string> {
      const snapshot = new Map<string, string>();
      for (const [mindId, entry] of entries) {
        snapshot.set(mindId, entry.cronExpr);
      }
      return snapshot;
    },

    close(): void {
      closed = true;
      for (const entry of entries.values()) {
        stopEntry(entry);
      }
      entries.clear();
    },
  };
}
