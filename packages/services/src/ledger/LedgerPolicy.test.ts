import { describe, expect, it } from 'vitest';
import { LedgerPolicy } from './LedgerPolicy';

describe('LedgerPolicy', () => {
  it('classifies terminal statuses', () => {
    const policy = new LedgerPolicy();

    expect(policy.isTerminal('queued')).toBe(false);
    expect(policy.isTerminal('running')).toBe(false);
    expect(policy.isTerminal('succeeded')).toBe(true);
    expect(policy.isTerminal('failed')).toBe(true);
    expect(policy.isTerminal('timed-out')).toBe(true);
    expect(policy.isTerminal('cancelled')).toBe(true);
    expect(policy.isTerminal('lost')).toBe(true);
  });
});
