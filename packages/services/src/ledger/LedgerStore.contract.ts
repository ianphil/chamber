import { describe, expect, it } from 'vitest';
import type { LedgerStore } from './LedgerStore';
import { aLedgerRecord } from './builders';
import { LedgerDataError } from './errors';

export interface LedgerStoreContractOptions {
  createStore(): LedgerStore;
  destroyStore?(store: LedgerStore): void;
}

export function describeLedgerStoreContract(
  name: string,
  options: LedgerStoreContractOptions,
): void {
  describe(`${name} LedgerStore contract`, () => {
    function withStore(test: (store: LedgerStore) => void): void {
      const store = options.createStore();
      try {
        test(store);
      } finally {
        options.destroyStore?.(store);
      }
    }

    it('round-trips an upserted record by ledgerId', () => {
      withStore((store) => {
        const running = aLedgerRecord().build();

        store.upsert(running);

        expect(store.findByLedgerId(running.ledgerId)).toEqual(running);
      });
    });

    it('finds records by runtime and runKey', () => {
      withStore((store) => {
        const running = aLedgerRecord()
          .withRuntime('a2a')
          .withRunKey('a2a-run')
          .build();
        store.upsert(running);

        expect(store.findByRunKey('a2a', 'a2a-run')).toEqual(running);
        expect(store.findByRunKey('cron', 'a2a-run')).toBeUndefined();
      });
    });

    it('lists records matching a status', () => {
      withStore((store) => {
        const running = aLedgerRecord().withLedgerId('running').withStatus('running').build();
        const failed = aLedgerRecord().withLedgerId('failed').withRunKey('failed-run').withStatus('failed').build();
        store.upsert(running);
        store.upsert(failed);

        expect(store.listByStatus('running')).toEqual([running]);
      });
    });

    it('lists records matching a runtime', () => {
      withStore((store) => {
        const cron = aLedgerRecord().withLedgerId('cron').withRuntime('cron').withRunKey('cron-run').build();
        const a2a = aLedgerRecord().withLedgerId('a2a').withRuntime('a2a').withRunKey('a2a-run').build();
        store.upsert(cron);
        store.upsert(a2a);

        expect(store.listByRuntime('cron')).toEqual([cron]);
      });
    });

    it('rejects duplicate runtime/runKey records', () => {
      withStore((store) => {
        const first = aLedgerRecord().withLedgerId('ledger-1').withRunKey('same-run').build();
        const second = aLedgerRecord().withLedgerId('ledger-2').withRunKey('same-run').build();
        store.upsert(first);

        expect(() => store.upsert(second)).toThrow(LedgerDataError);
      });
    });

    it('deletes records by ledgerId', () => {
      withStore((store) => {
        const record = aLedgerRecord().withLedgerId('delete-me').build();
        store.upsert(record);

        expect(store.deleteByLedgerId('delete-me')).toBe(true);
        expect(store.findByLedgerId('delete-me')).toBeUndefined();
        expect(store.deleteByLedgerId('delete-me')).toBe(false);
      });
    });
  });
}
