/**
 * Tests for dream-gates — combined activity/time/lock gate evaluation.
 *
 * Phase 7 acceptance:
 *   - All three gates must pass for run=true.
 *   - Each failure produces a distinct, machine-readable reason.
 *   - Boundary conditions: exactly threshold, exact equality on time gate.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DAILY_GATE,
  evaluateGates,
  type GateConfig,
  type GateInput,
} from './dream-gates';
import type { DreamState } from './dream-state';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function baseState(overrides: Partial<DreamState> = {}): DreamState {
  return {
    turnsSinceLastRun: 5,
    lastDailyAt: null,
    lastWeeklyAt: null,
    lastMonthlyAt: null,
    lastConsolidatedTurnId: null,
    ...overrides,
  };
}

function input(overrides: Partial<GateInput> = {}): GateInput {
  return {
    phase: 'daily',
    state: baseState(),
    now: 10 * MS_PER_DAY,
    lockHeld: false,
    ...overrides,
  };
}

describe('dream-gates — lock gate', () => {
  it('returns run=false reason=locked when the lock is held, regardless of activity/time', () => {
    const r = evaluateGates(
      input({
        lockHeld: true,
        state: baseState({ turnsSinceLastRun: 1000, lastDailyAt: 0 }),
      }),
      DEFAULT_DAILY_GATE,
    );
    expect(r.run).toBe(false);
    expect(r.reason).toBe('locked');
  });
});

describe('dream-gates — activity gate', () => {
  it('passes when turnsSinceLastRun >= minTurnsBetweenRuns', () => {
    const cfg: GateConfig = { minTurnsBetweenRuns: 5, minIntervalMs: 0 };
    const r = evaluateGates(input({ state: baseState({ turnsSinceLastRun: 5 }) }), cfg);
    expect(r.run).toBe(true);
    expect(r.reason).toBe('ready');
  });

  it('fails when turnsSinceLastRun < minTurnsBetweenRuns', () => {
    const cfg: GateConfig = { minTurnsBetweenRuns: 5, minIntervalMs: 0 };
    const r = evaluateGates(input({ state: baseState({ turnsSinceLastRun: 4 }) }), cfg);
    expect(r.run).toBe(false);
    expect(r.reason).toBe('no-activity');
  });

  it('fails on zero turns even when threshold is 1', () => {
    const cfg: GateConfig = { minTurnsBetweenRuns: 1, minIntervalMs: 0 };
    const r = evaluateGates(input({ state: baseState({ turnsSinceLastRun: 0 }) }), cfg);
    expect(r.run).toBe(false);
    expect(r.reason).toBe('no-activity');
  });
});

describe('dream-gates — time gate', () => {
  it('passes when no prior daily run has been recorded', () => {
    const r = evaluateGates(
      input({ state: baseState({ turnsSinceLastRun: 1, lastDailyAt: null }), now: 1 }),
      DEFAULT_DAILY_GATE,
    );
    expect(r.run).toBe(true);
  });

  it('fails when (now - lastDailyAt) < minIntervalMs', () => {
    const r = evaluateGates(
      input({
        state: baseState({ turnsSinceLastRun: 10, lastDailyAt: 5 * MS_PER_DAY }),
        now: 5 * MS_PER_DAY + (MS_PER_DAY - 1),
      }),
      DEFAULT_DAILY_GATE,
    );
    expect(r.run).toBe(false);
    expect(r.reason).toBe('too-soon');
  });

  it('passes at exactly the interval boundary', () => {
    const r = evaluateGates(
      input({
        state: baseState({ turnsSinceLastRun: 10, lastDailyAt: 5 * MS_PER_DAY }),
        now: 5 * MS_PER_DAY + MS_PER_DAY,
      }),
      DEFAULT_DAILY_GATE,
    );
    expect(r.run).toBe(true);
  });
});

describe('dream-gates — phase selection', () => {
  it('weekly phase reads lastWeeklyAt, ignores lastDailyAt', () => {
    const cfg: GateConfig = { minTurnsBetweenRuns: 1, minIntervalMs: MS_PER_DAY };
    const r = evaluateGates(
      input({
        phase: 'weekly',
        state: baseState({
          turnsSinceLastRun: 1,
          lastDailyAt: 999 * MS_PER_DAY, // would block daily
          lastWeeklyAt: null,
        }),
        now: 10 * MS_PER_DAY,
      }),
      cfg,
    );
    expect(r.run).toBe(true);
  });

  it('monthly phase reads lastMonthlyAt', () => {
    const cfg: GateConfig = { minTurnsBetweenRuns: 1, minIntervalMs: MS_PER_DAY };
    const r = evaluateGates(
      input({
        phase: 'monthly',
        state: baseState({
          turnsSinceLastRun: 1,
          lastMonthlyAt: 10 * MS_PER_DAY - 1,
        }),
        now: 10 * MS_PER_DAY,
      }),
      cfg,
    );
    expect(r.run).toBe(false);
    expect(r.reason).toBe('too-soon');
  });
});

describe('dream-gates — combination matrix', () => {
  const cfg: GateConfig = { minTurnsBetweenRuns: 5, minIntervalMs: MS_PER_DAY };

  it.each([
    ['activity-fail, time-fail, unlocked', { turns: 1, lastAt: 9.5 * MS_PER_DAY, lockHeld: false }, false, 'no-activity'],
    ['activity-pass, time-fail, unlocked', { turns: 5, lastAt: 9.5 * MS_PER_DAY, lockHeld: false }, false, 'too-soon'],
    ['activity-fail, time-pass, unlocked', { turns: 1, lastAt: 0, lockHeld: false }, false, 'no-activity'],
    ['activity-pass, time-pass, locked', { turns: 5, lastAt: 0, lockHeld: true }, false, 'locked'],
    ['activity-pass, time-pass, unlocked', { turns: 5, lastAt: 0, lockHeld: false }, true, 'ready'],
  ])('%s → run=%s reason=%s', (_label, args, expectedRun, expectedReason) => {
    const r = evaluateGates(
      input({
        state: baseState({ turnsSinceLastRun: args.turns, lastDailyAt: args.lastAt }),
        now: 10 * MS_PER_DAY,
        lockHeld: args.lockHeld,
      }),
      cfg,
    );
    expect(r.run).toBe(expectedRun);
    expect(r.reason).toBe(expectedReason);
  });
});
