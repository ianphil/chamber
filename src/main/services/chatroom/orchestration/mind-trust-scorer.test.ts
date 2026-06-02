import { describe, it, expect, beforeEach } from 'vitest';
import { MindTrustScorer } from './mind-trust-scorer';
import type { TrustEvent } from './mind-trust-scorer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(
  mindId: string,
  outcome: TrustEvent['outcome'],
  toolName = 'test_tool',
): TrustEvent {
  return { mindId, toolName, outcome, timestamp: Date.now() };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MindTrustScorer', () => {
  let scorer: MindTrustScorer;

  beforeEach(() => {
    scorer = new MindTrustScorer();
  });

  describe('initial state', () => {
    it('returns base score (1.0) for unknown mind', () => {
      expect(scorer.score('unknown')).toBe(1.0);
    });

    it('returns verified tier for unknown mind', () => {
      expect(scorer.tier('unknown')).toBe('verified');
    });

    it('snapshot is empty before any events', () => {
      expect(scorer.snapshot()).toEqual([]);
    });

    it('history is empty before any events', () => {
      expect(scorer.getHistory()).toEqual([]);
    });
  });

  describe('approval events', () => {
    it('slightly increases score above base', () => {
      // Already at 1.0 (max), approval should cap at 1.0
      scorer.record(makeEvent('mind-a', 'approved'));
      expect(scorer.score('mind-a')).toBe(1.0);
    });

    it('recovers score after denial', () => {
      scorer.record(makeEvent('mind-a', 'denied'));
      const afterDenial = scorer.score('mind-a');
      scorer.record(makeEvent('mind-a', 'approved'));
      expect(scorer.score('mind-a')).toBeGreaterThan(afterDenial);
    });

    it('increments approved count', () => {
      scorer.record(makeEvent('mind-a', 'approved'));
      scorer.record(makeEvent('mind-a', 'approved'));
      expect(scorer.getRecord('mind-a').totalApproved).toBe(2);
    });
  });

  describe('denial events', () => {
    it('decreases score by 0.10', () => {
      scorer.record(makeEvent('mind-a', 'denied'));
      expect(scorer.score('mind-a')).toBe(0.90);
    });

    it('multiple denials accumulate', () => {
      scorer.record(makeEvent('mind-a', 'denied'));
      scorer.record(makeEvent('mind-a', 'denied'));
      expect(scorer.score('mind-a')).toBe(0.80);
    });

    it('score never goes below 0.0', () => {
      for (let i = 0; i < 20; i++) {
        scorer.record(makeEvent('mind-a', 'denied'));
      }
      expect(scorer.score('mind-a')).toBeGreaterThanOrEqual(0.0);
    });

    it('increments denied count', () => {
      scorer.record(makeEvent('mind-a', 'denied'));
      expect(scorer.getRecord('mind-a').totalDenied).toBe(1);
    });
  });

  describe('block events', () => {
    it('decreases score by 0.15 (more than denial)', () => {
      scorer.record(makeEvent('mind-a', 'blocked'));
      expect(scorer.score('mind-a')).toBe(0.85);
    });

    it('increments blocked count', () => {
      scorer.record(makeEvent('mind-a', 'blocked'));
      scorer.record(makeEvent('mind-a', 'blocked'));
      expect(scorer.getRecord('mind-a').totalBlocked).toBe(2);
    });
  });

  describe('tier classification', () => {
    it('starts as verified (score >= 0.90)', () => {
      scorer.record(makeEvent('mind-a', 'approved'));
      expect(scorer.tier('mind-a')).toBe('verified');
    });

    it('drops to trusted after one denial (0.90)', () => {
      scorer.record(makeEvent('mind-a', 'denied'));
      expect(scorer.tier('mind-a')).toBe('verified'); // 0.90 is still >= 0.90
    });

    it('drops to trusted after two denials (0.80)', () => {
      scorer.record(makeEvent('mind-a', 'denied'));
      scorer.record(makeEvent('mind-a', 'denied'));
      expect(scorer.tier('mind-a')).toBe('trusted'); // 0.80
    });

    it('drops to standard after multiple denials', () => {
      for (let i = 0; i < 4; i++) {
        scorer.record(makeEvent('mind-a', 'denied'));
      }
      expect(scorer.tier('mind-a')).toBe('standard'); // 0.60
    });

    it('drops to probationary after many denials', () => {
      for (let i = 0; i < 7; i++) {
        scorer.record(makeEvent('mind-a', 'denied'));
      }
      expect(scorer.tier('mind-a')).toBe('probationary'); // 0.30
    });

    it('drops to untrusted after excessive denials', () => {
      for (let i = 0; i < 10; i++) {
        scorer.record(makeEvent('mind-a', 'denied'));
      }
      expect(scorer.tier('mind-a')).toBe('untrusted'); // 0.00
    });
  });

  describe('multi-mind tracking', () => {
    it('tracks minds independently', () => {
      scorer.record(makeEvent('mind-a', 'denied'));
      scorer.record(makeEvent('mind-b', 'approved'));

      expect(scorer.score('mind-a')).toBe(0.90);
      expect(scorer.score('mind-b')).toBe(1.0);
    });

    it('snapshot returns all tracked minds', () => {
      scorer.record(makeEvent('mind-a', 'approved'));
      scorer.record(makeEvent('mind-b', 'denied'));
      scorer.record(makeEvent('mind-c', 'blocked'));

      const snap = scorer.snapshot();
      expect(snap).toHaveLength(3);
      const ids = snap.map((r) => r.mindId).sort();
      expect(ids).toEqual(['mind-a', 'mind-b', 'mind-c']);
    });
  });

  describe('trust record', () => {
    it('returns complete record with all fields', () => {
      scorer.record(makeEvent('mind-a', 'approved'));
      scorer.record(makeEvent('mind-a', 'denied'));
      scorer.record(makeEvent('mind-a', 'blocked'));

      const record = scorer.getRecord('mind-a');
      expect(record.mindId).toBe('mind-a');
      expect(record.score).toBeDefined();
      expect(record.tier).toBeDefined();
      expect(record.totalApproved).toBe(1);
      expect(record.totalDenied).toBe(1);
      expect(record.totalBlocked).toBe(1);
      expect(record.lastUpdated).toBeGreaterThan(0);
    });

    it('returns default record for unknown mind', () => {
      const record = scorer.getRecord('unknown');
      expect(record.score).toBe(1.0);
      expect(record.tier).toBe('verified');
      expect(record.totalApproved).toBe(0);
      expect(record.totalDenied).toBe(0);
      expect(record.totalBlocked).toBe(0);
    });
  });

  describe('history', () => {
    it('records all events in order', () => {
      scorer.record(makeEvent('mind-a', 'approved', 'read_file'));
      scorer.record(makeEvent('mind-a', 'denied', 'delete_user'));

      const history = scorer.getHistory();
      expect(history).toHaveLength(2);
      expect(history[0].toolName).toBe('read_file');
      expect(history[1].toolName).toBe('delete_user');
    });

    it('returns a copy, not the internal array', () => {
      scorer.record(makeEvent('mind-a', 'approved'));
      const h1 = scorer.getHistory();
      const h2 = scorer.getHistory();
      expect(h1).not.toBe(h2);
      expect(h1).toEqual(h2);
    });
  });

  describe('reset', () => {
    it('resets mind score to base', () => {
      scorer.record(makeEvent('mind-a', 'denied'));
      scorer.record(makeEvent('mind-a', 'denied'));
      expect(scorer.score('mind-a')).toBeLessThan(1.0);

      scorer.reset('mind-a');
      expect(scorer.score('mind-a')).toBe(1.0);
    });

    it('resets counters to zero', () => {
      scorer.record(makeEvent('mind-a', 'denied'));
      scorer.record(makeEvent('mind-a', 'blocked'));
      scorer.reset('mind-a');

      const record = scorer.getRecord('mind-a');
      expect(record.totalApproved).toBe(0);
      expect(record.totalDenied).toBe(0);
      expect(record.totalBlocked).toBe(0);
    });

    it('does not affect other minds', () => {
      scorer.record(makeEvent('mind-a', 'denied'));
      scorer.record(makeEvent('mind-b', 'denied'));

      scorer.reset('mind-a');
      expect(scorer.score('mind-a')).toBe(1.0);
      expect(scorer.score('mind-b')).toBe(0.90);
    });
  });

  describe('trust asymmetry', () => {
    it('trust is hard to earn, easy to lose', () => {
      // One denial drops 0.10, but one approval only recovers 0.02
      scorer.record(makeEvent('mind-a', 'denied'));
      const afterDenial = scorer.score('mind-a');
      scorer.record(makeEvent('mind-a', 'approved'));
      const afterApproval = scorer.score('mind-a');

      // Should take 5 approvals to recover from 1 denial
      expect(afterApproval - afterDenial).toBeCloseTo(0.02);
      expect(1.0 - afterApproval).toBeGreaterThan(0.02);
    });
  });
});
