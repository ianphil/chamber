/**
 * Tests for InternalScheduler — Phase 10.
 *
 * Per-mind in-process croner job runner that drives DreamDaemon.run() on a
 * configurable cadence. Deliberately NOT registered with the user-facing
 * CronService so the user's cron list stays clean.
 *
 * croner is driven off `Date.now()` and `setTimeout`. Vitest 4's
 * `vi.useFakeTimers()` fakes both by default, so deterministic assertions
 * on cron firings work as long as we advance time with
 * `vi.advanceTimersByTimeAsync`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createInternalScheduler,
  type InternalScheduler,
} from './InternalScheduler';

const EVERY_SECOND = '* * * * * *';

let scheduler: InternalScheduler;

beforeEach(() => {
  vi.useFakeTimers();
  // Pin the wall clock so croner's "next second boundary" is predictable.
  vi.setSystemTime(new Date('2026-05-12T15:00:00.000Z'));
  scheduler = createInternalScheduler({ random: () => 0 });
});

afterEach(() => {
  scheduler.close();
  vi.useRealTimers();
});

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('createInternalScheduler', () => {
  describe('register', () => {
    it('exposes the registered cron expression via list()', () => {
      scheduler.register({
        mindId: 'mind-a',
        cronExpr: '0 3 * * *',
        fn: async () => undefined,
      });

      const entries = scheduler.list();
      expect(entries.size).toBe(1);
      expect(entries.get('mind-a')).toBe('0 3 * * *');
    });

    it('throws synchronously on an invalid cron expression', () => {
      expect(() =>
        scheduler.register({
          mindId: 'mind-bad',
          cronExpr: 'not-a-cron',
          fn: async () => undefined,
        }),
      ).toThrow();
      expect(scheduler.list().has('mind-bad')).toBe(false);
    });

    it('replaces an existing entry for the same mindId — old fn no longer fires', async () => {
      const oldCalls: number[] = [];
      const newCalls: number[] = [];

      scheduler.register({
        mindId: 'mind-a',
        cronExpr: EVERY_SECOND,
        fn: async () => {
          oldCalls.push(Date.now());
        },
      });

      // Replace before the next tick fires.
      scheduler.register({
        mindId: 'mind-a',
        cronExpr: EVERY_SECOND,
        fn: async () => {
          newCalls.push(Date.now());
        },
      });

      // Advance well past two cron boundaries; only the new fn should fire.
      await vi.advanceTimersByTimeAsync(2_500);

      expect(oldCalls).toHaveLength(0);
      expect(newCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('unregister', () => {
    it('is a no-op for an unknown mindId', () => {
      expect(() => scheduler.unregister('never-registered')).not.toThrow();
    });

    it('stops only the targeted mind — other minds keep firing', async () => {
      const aCalls: number[] = [];
      const bCalls: number[] = [];

      scheduler.register({
        mindId: 'mind-a',
        cronExpr: EVERY_SECOND,
        fn: async () => {
          aCalls.push(Date.now());
        },
      });
      scheduler.register({
        mindId: 'mind-b',
        cronExpr: EVERY_SECOND,
        fn: async () => {
          bCalls.push(Date.now());
        },
      });

      // Let one tick happen for both, then drop mind-a.
      await vi.advanceTimersByTimeAsync(1_500);
      const aBefore = aCalls.length;
      const bBefore = bCalls.length;
      expect(aBefore).toBeGreaterThanOrEqual(1);
      expect(bBefore).toBeGreaterThanOrEqual(1);

      scheduler.unregister('mind-a');
      expect(scheduler.list().has('mind-a')).toBe(false);
      expect(scheduler.list().has('mind-b')).toBe(true);

      await vi.advanceTimersByTimeAsync(2_000);

      expect(aCalls.length).toBe(aBefore);
      expect(bCalls.length).toBeGreaterThan(bBefore);
    });
  });

  describe('runNow', () => {
    it('invokes the registered fn immediately, out of band', async () => {
      let calls = 0;
      scheduler.register({
        mindId: 'mind-a',
        cronExpr: '0 3 * * *', // never naturally fires within the test window
        fn: async () => {
          calls += 1;
        },
      });

      await scheduler.runNow('mind-a');

      expect(calls).toBe(1);
    });

    it('throws when the mind is not registered', async () => {
      await expect(scheduler.runNow('nobody')).rejects.toThrow(/not registered/i);
    });

    it('returns the in-flight promise when a tick is already executing', async () => {
      const gate = deferred<void>();
      let calls = 0;

      scheduler.register({
        mindId: 'mind-a',
        cronExpr: '0 3 * * *',
        fn: async () => {
          calls += 1;
          await gate.promise;
        },
      });

      const first = scheduler.runNow('mind-a');
      // Yield so the fn body starts and registers its in-flight promise.
      await Promise.resolve();
      const second = scheduler.runNow('mind-a');

      gate.resolve();
      await first;
      await second;

      expect(calls).toBe(1);
    });

    it('drops a re-entrant cron tick while a previous run is still in flight', async () => {
      const gate = deferred<void>();
      let calls = 0;

      scheduler.register({
        mindId: 'mind-a',
        cronExpr: EVERY_SECOND,
        fn: async () => {
          calls += 1;
          await gate.promise;
        },
      });

      // Advance across multiple cron boundaries while the first invocation is
      // still pending. Subsequent ticks should see the in-flight guard and be
      // dropped — fn must run exactly once until we release it.
      await vi.advanceTimersByTimeAsync(3_500);
      expect(calls).toBe(1);

      gate.resolve();
      // Drain the pending promise to release in-flight state.
      await vi.advanceTimersByTimeAsync(0);
      // Future ticks may now fire normally — no assertion needed beyond the
      // invariant that the first run was not double-invoked.
    });
  });

  describe('jitter', () => {
    it('delays the fn by random() * jitterMs before invoking', async () => {
      const fireTimes: number[] = [];
      const jitterScheduler = createInternalScheduler({ random: () => 0.5 });
      try {
        jitterScheduler.register({
          mindId: 'mind-jitter',
          cronExpr: EVERY_SECOND,
          fn: async () => {
            fireTimes.push(Date.now());
          },
          jitterMs: 100,
        });

        // Walk forward to the next 1-second cron boundary, then up to but not
        // past the jitter window.
        const start = Date.now();
        // Advance to first boundary.
        await vi.advanceTimersByTimeAsync(1_000);
        // Advance through 49 ms of jitter — fn should NOT have fired yet
        // (random() * 100 = 50, fn fires at boundary + 50ms).
        await vi.advanceTimersByTimeAsync(49);
        expect(fireTimes).toHaveLength(0);
        // Push past the 50 ms jitter — fn fires now.
        await vi.advanceTimersByTimeAsync(2);
        expect(fireTimes).toHaveLength(1);
        // The fn fired ~1050 ms after start.
        expect(fireTimes[0] - start).toBeGreaterThanOrEqual(1_050);
        expect(fireTimes[0] - start).toBeLessThan(1_100);
      } finally {
        jitterScheduler.close();
      }
    });
  });

  describe('error handling', () => {
    it('does not break the schedule when fn throws — subsequent ticks still fire', async () => {
      let calls = 0;
      scheduler.register({
        mindId: 'mind-a',
        cronExpr: EVERY_SECOND,
        fn: async () => {
          calls += 1;
          if (calls === 1) {
            throw new Error('boom');
          }
        },
      });

      // First tick throws, should be caught.
      await vi.advanceTimersByTimeAsync(1_500);
      expect(calls).toBeGreaterThanOrEqual(1);

      // Second tick should still fire.
      await vi.advanceTimersByTimeAsync(1_500);
      expect(calls).toBeGreaterThanOrEqual(2);
    });
  });

  describe('close', () => {
    it('stops every job and clears the registry', async () => {
      let aCalls = 0;
      let bCalls = 0;
      scheduler.register({
        mindId: 'mind-a',
        cronExpr: EVERY_SECOND,
        fn: async () => {
          aCalls += 1;
        },
      });
      scheduler.register({
        mindId: 'mind-b',
        cronExpr: EVERY_SECOND,
        fn: async () => {
          bCalls += 1;
        },
      });

      await vi.advanceTimersByTimeAsync(1_500);
      const aSnap = aCalls;
      const bSnap = bCalls;
      expect(aSnap).toBeGreaterThanOrEqual(1);
      expect(bSnap).toBeGreaterThanOrEqual(1);

      scheduler.close();
      expect(scheduler.list().size).toBe(0);

      await vi.advanceTimersByTimeAsync(3_000);
      expect(aCalls).toBe(aSnap);
      expect(bCalls).toBe(bSnap);
    });

    it('is idempotent', () => {
      scheduler.register({
        mindId: 'mind-a',
        cronExpr: EVERY_SECOND,
        fn: async () => undefined,
      });
      scheduler.close();
      expect(() => scheduler.close()).not.toThrow();
      expect(scheduler.list().size).toBe(0);
    });

    it('rejects register() after close to surface lifecycle bugs', () => {
      scheduler.close();
      expect(() =>
        scheduler.register({
          mindId: 'mind-a',
          cronExpr: '0 3 * * *',
          fn: async () => undefined,
        }),
      ).toThrow(/closed/i);
    });
  });
});
