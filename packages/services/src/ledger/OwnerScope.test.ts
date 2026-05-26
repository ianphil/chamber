import { describe, expect, it, vi } from 'vitest';
import type { CancelOutcome } from '@chamber/shared';
import { aLedgerRecord } from './builders';
import { InMemoryLedgerStore } from './InMemoryLedgerStore';
import { LedgerCanceller } from './LedgerCanceller';
import { LedgerReader } from './LedgerReader';
import { OwnerScope } from './OwnerScope';

describe('OwnerScope', () => {
  it('finds a ledger record only when the scoped id belongs to the owner', () => {
    const store = new InMemoryLedgerStore();
    const task = aLedgerRecord().withLedgerId('ledger-1').forMind('mind-a').build();
    store.upsert(task);
    const scope = new OwnerScope('mind-a', new LedgerReader(store), new LedgerCanceller(store));

    expect(scope.getByLedgerId('mind-a:ledger-1')).toEqual(task);
  });

  it('returns Unknown job_id for a missing record', () => {
    const store = new InMemoryLedgerStore();
    const scope = new OwnerScope('mind-a', new LedgerReader(store), new LedgerCanceller(store));

    expect(() => scope.getByLedgerId('mind-a:missing')).toThrow('Unknown job_id: mind-a:missing');
  });

  it('returns the same Unknown job_id shape for wrong-owner records', () => {
    const store = new InMemoryLedgerStore();
    store.upsert(aLedgerRecord().withLedgerId('ledger-1').forMind('mind-b').build());
    const scope = new OwnerScope('mind-a', new LedgerReader(store), new LedgerCanceller(store));

    expect(() => scope.getByLedgerId('mind-a:ledger-1')).toThrow('Unknown job_id: mind-a:ledger-1');
  });

  it('filters before dispatching cancel for wrong-owner records', () => {
    const store = new InMemoryLedgerStore();
    store.upsert(aLedgerRecord().withLedgerId('ledger-1').forMind('mind-b').build());
    const cancel = vi.fn<(_: string) => CancelOutcome>();
    const scope = new OwnerScope('mind-a', new LedgerReader(store), { cancel });

    expect(scope.cancelByLedgerId('mind-a:ledger-1')).toEqual({
      found: false,
      cancelled: false,
      reason: 'Unknown job_id: mind-a:ledger-1',
    });
    expect(cancel).not.toHaveBeenCalled();
  });

  it('dispatches cancel for records owned by the scope', () => {
    const store = new InMemoryLedgerStore();
    const task = aLedgerRecord().withLedgerId('ledger-1').forMind('mind-a').build();
    store.upsert(task);
    const outcome = { found: true, cancelled: false, reason: 'refused', task };
    const cancel = vi.fn<(_: string) => CancelOutcome>(() => outcome);
    const scope = new OwnerScope('mind-a', new LedgerReader(store), { cancel });

    expect(scope.cancelByLedgerId('mind-a:ledger-1')).toBe(outcome);
    expect(cancel).toHaveBeenCalledWith('ledger-1');
  });
});
