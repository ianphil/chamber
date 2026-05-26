import { describe, expect, it } from 'vitest';
import { aLedgerRecord } from './builders';
import { InMemoryLedgerStore } from './InMemoryLedgerStore';
import { LedgerSweeper } from './LedgerSweeper';

describe('LedgerSweeper', () => {
  it('marks stale running records as lost', () => {
    const store = new InMemoryLedgerStore();
    store.upsert({
      ...aLedgerRecord().withLedgerId('stale').withStatus('running').build(),
      lastEventAt: '2026-05-20T00:00:00.000Z',
    });
    store.upsert({
      ...aLedgerRecord().withLedgerId('fresh').withRunKey('fresh').withStatus('running').build(),
      lastEventAt: '2026-05-21T21:00:00.000Z',
    });
    const sweeper = new LedgerSweeper(store, {
      staleAfterMs: 60 * 60 * 1000,
      now: () => '2026-05-21T21:30:00.000Z',
    });

    expect(sweeper.sweep()).toEqual({ scanned: 1, markedLost: 1 });
    expect(store.findByLedgerId('stale')).toMatchObject({
      status: 'lost',
      terminalSummary: 'lost',
      cleanupAfter: '2026-06-20T21:30:00.000Z',
    });
    expect(store.findByLedgerId('fresh')?.status).toBe('running');
  });
});
