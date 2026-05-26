import { describe, expect, it } from 'vitest';
import { aLedgerRecord } from './builders';
import { InMemoryLedgerStore } from './InMemoryLedgerStore';
import { LedgerCanceller } from './LedgerCanceller';

describe('LedgerCanceller', () => {
  it('returns not found for an unknown ledgerId', () => {
    const canceller = new LedgerCanceller(new InMemoryLedgerStore());

    expect(canceller.cancel('missing')).toEqual({
      found: false,
      cancelled: false,
      reason: 'Ledger record not found: missing',
    });
  });

  it('does not cancel terminal records', () => {
    const store = new InMemoryLedgerStore();
    const task = aLedgerRecord().withLedgerId('ledger-1').withStatus('succeeded').build();
    store.upsert(task);
    const canceller = new LedgerCanceller(store);

    expect(canceller.cancel('ledger-1')).toEqual({
      found: true,
      cancelled: false,
      reason: 'Task is already terminal: succeeded',
      task,
    });
  });

  it('refuses cron run cancellation without changing the record', () => {
    const store = new InMemoryLedgerStore();
    const task = aLedgerRecord().withLedgerId('ledger-1').withRuntime('cron').build();
    store.upsert(task);
    const canceller = new LedgerCanceller(store);

    expect(canceller.cancel('ledger-1')).toEqual({
      found: true,
      cancelled: false,
      reason: 'Cron run cannot be cancelled; remove the schedule instead.',
      task,
    });
    expect(store.findByLedgerId('ledger-1')).toEqual(task);
  });

  it('refuses runtimes whose producer cancellation is not wired yet', () => {
    const store = new InMemoryLedgerStore();
    const task = aLedgerRecord().withLedgerId('ledger-1').withRuntime('a2a').build();
    store.upsert(task);
    const canceller = new LedgerCanceller(store);

    expect(canceller.cancel('ledger-1')).toEqual({
      found: true,
      cancelled: false,
      reason: 'Cancellation for a2a is not wired yet.',
      task,
    });
  });
});
