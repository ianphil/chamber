import { describe, it, expect } from 'vitest';
import {
  MAX_AGGREGATE_TRANSITION_DURATION_MS,
  MAX_TRANSITION_DURATION_MS,
  REDUCED_MOTION_EQUIVALENT,
  VESTIBULAR_RISKY_TRANSITIONS,
} from './motionLimits';

describe('motionLimits constants', () => {
  it('MAX_TRANSITION_DURATION_MS is a positive number under 1 second', () => {
    expect(typeof MAX_TRANSITION_DURATION_MS).toBe('number');
    expect(MAX_TRANSITION_DURATION_MS).toBeGreaterThan(0);
    // WCAG 2.2.2 mandates pause-controls for motion > 5 seconds; Sullivan's
    // per-transition ceiling stays well under that to keep cognitive load low.
    expect(MAX_TRANSITION_DURATION_MS).toBeLessThan(1000);
  });

  it('MAX_TRANSITION_DURATION_MS is pinned to 800ms (Sullivan contract)', () => {
    // Pin the exact value so a silent refactor (e.g. to 999ms) fails CI.
    // This is the contract downstream rubrics rely on; the > 0 / < 1000
    // soft bounds above protect against gross drift but not subtle drift.
    expect(MAX_TRANSITION_DURATION_MS).toBe(800);
  });

  it('MAX_AGGREGATE_TRANSITION_DURATION_MS is a positive number and at least 2x per-transition', () => {
    expect(typeof MAX_AGGREGATE_TRANSITION_DURATION_MS).toBe('number');
    expect(MAX_AGGREGATE_TRANSITION_DURATION_MS).toBeGreaterThan(0);
    expect(MAX_AGGREGATE_TRANSITION_DURATION_MS).toBeGreaterThanOrEqual(
      MAX_TRANSITION_DURATION_MS * 2,
    );
  });

  it('MAX_AGGREGATE_TRANSITION_DURATION_MS is pinned to 4000ms (Sullivan contract)', () => {
    // Same rationale as the per-transition pin: protect against silent drift.
    expect(MAX_AGGREGATE_TRANSITION_DURATION_MS).toBe(4000);
  });

  it('VESTIBULAR_RISKY_TRANSITIONS includes the canonical risky transition names', () => {
    expect(VESTIBULAR_RISKY_TRANSITIONS.has('zoom')).toBe(true);
    expect(VESTIBULAR_RISKY_TRANSITIONS.has('parallax')).toBe(true);
    expect(VESTIBULAR_RISKY_TRANSITIONS.has('spin')).toBe(true);
    expect(VESTIBULAR_RISKY_TRANSITIONS.has('flip')).toBe(true);
  });

  it('VESTIBULAR_RISKY_TRANSITIONS does NOT include vestibular-safe transitions', () => {
    expect(VESTIBULAR_RISKY_TRANSITIONS.has('fade')).toBe(false);
    expect(VESTIBULAR_RISKY_TRANSITIONS.has('none')).toBe(false);
  });

  it('REDUCED_MOTION_EQUIVALENT maps every risky transition to a safe one', () => {
    for (const risky of VESTIBULAR_RISKY_TRANSITIONS) {
      expect(REDUCED_MOTION_EQUIVALENT[risky]).toBeDefined();
      expect(VESTIBULAR_RISKY_TRANSITIONS.has(REDUCED_MOTION_EQUIVALENT[risky])).toBe(false);
    }
  });
});
