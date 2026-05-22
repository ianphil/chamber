import { describe, expectTypeOf, it } from 'vitest';
import type { LedgerStore } from './LedgerStore';
import { InMemoryLedgerStore } from './InMemoryLedgerStore';
import { describeLedgerStoreContract } from './LedgerStore.contract';

describe('LedgerStore', () => {
  it('defines the persistence seam used by ledger services', () => {
    expectTypeOf<LedgerStore>().toHaveProperty('upsert');
    expectTypeOf<LedgerStore>().toHaveProperty('findByLedgerId');
    expectTypeOf<LedgerStore>().toHaveProperty('findByRunKey');
    expectTypeOf<LedgerStore>().toHaveProperty('listByStatus');
  });
});

describeLedgerStoreContract('InMemoryLedgerStore', {
  createStore: () => new InMemoryLedgerStore(),
});
