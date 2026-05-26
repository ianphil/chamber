import { describe, expect, it } from 'vitest';
import { aLedgerRecord } from './builders';
import { InMemoryLedgerStore } from './InMemoryLedgerStore';
import { LedgerPruner } from './LedgerPruner';

describe('LedgerPruner', () => {
  it('deletes terminal records past cleanupAfter', () => {
    const store = new InMemoryLedgerStore();
    store.upsert({
      ...aLedgerRecord().withLedgerId('expired').withStatus('succeeded').build(),
      cleanupAfter: '2026-05-20T00:00:00.000Z',
    });
    store.upsert({
      ...aLedgerRecord().withLedgerId('kept').withRunKey('kept').withStatus('succeeded').build(),
      cleanupAfter: '2026-05-22T00:00:00.000Z',
    });

    const pruner = new LedgerPruner(store, () => '2026-05-21T21:30:00.000Z');

    expect(pruner.pruneExpired()).toEqual({ scanned: 1, deleted: 1 });
    expect(store.findByLedgerId('expired')).toBeUndefined();
    expect(store.findByLedgerId('kept')).toBeDefined();
  });
});
