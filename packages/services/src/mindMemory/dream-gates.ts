/**
 * dream-gates — combined lock + activity + time gate evaluation for the
 * Dream Daemon. Replaces SCNS's "session count" gate with an *activity*
 * gate driven by `turns_since_last_run`.
 *
 * The activity counter is bumped by DailyLogWriter when it appends a turn
 * frame, NOT by SDK session start. This keeps the daemon from running
 * after idle reconnects.
 *
 * `evaluateGates` is pure: it takes a snapshot of state + clock + lock
 * status and returns `{ run, reason }`. The caller is responsible for
 * checking the consolidation-enabled flag from `.chamber.json` before
 * invoking this function.
 *
 * Gate order (first failure short-circuits):
 *   1. Lock gate     reason='locked'
 *   2. Activity gate reason='no-activity'
 *   3. Time gate     reason='too-soon'
 *   else             reason='ready'
 */

import type { DreamPhase } from './dream-schema';
import type { DreamState } from './dream-state';

export interface GateConfig {
  readonly minTurnsBetweenRuns: number;
  readonly minIntervalMs: number;
}

export interface GateInput {
  readonly phase: DreamPhase;
  readonly state: DreamState;
  readonly now: number;
  readonly lockHeld: boolean;
}

export type GateReason = 'locked' | 'no-activity' | 'too-soon' | 'ready';

export interface GateResult {
  readonly run: boolean;
  readonly reason: GateReason;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const DEFAULT_DAILY_GATE: GateConfig = {
  minTurnsBetweenRuns: 1,
  minIntervalMs: MS_PER_DAY,
};

export const DEFAULT_WEEKLY_GATE: GateConfig = {
  minTurnsBetweenRuns: 1,
  minIntervalMs: 7 * MS_PER_DAY,
};

export const DEFAULT_MONTHLY_GATE: GateConfig = {
  minTurnsBetweenRuns: 1,
  minIntervalMs: 30 * MS_PER_DAY,
};

function lastPhaseAt(state: DreamState, phase: DreamPhase): number | null {
  switch (phase) {
    case 'daily':
      return state.lastDailyAt;
    case 'weekly':
      return state.lastWeeklyAt;
    case 'monthly':
      return state.lastMonthlyAt;
  }
}

export function evaluateGates(input: GateInput, config: GateConfig): GateResult {
  if (input.lockHeld) {
    return { run: false, reason: 'locked' };
  }

  if (input.state.turnsSinceLastRun < config.minTurnsBetweenRuns) {
    return { run: false, reason: 'no-activity' };
  }

  const last = lastPhaseAt(input.state, input.phase);
  if (last !== null && input.now - last < config.minIntervalMs) {
    return { run: false, reason: 'too-soon' };
  }

  return { run: true, reason: 'ready' };
}
