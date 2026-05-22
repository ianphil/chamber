import { describe, expect, it } from 'vitest';
import { aLedgerRecord } from './builders';
import { InMemoryLedgerStore } from './InMemoryLedgerStore';
import { LedgerReader } from './LedgerReader';

describe('LedgerReader', () => {
  it('gets a task by ledgerId', () => {
    const store = new InMemoryLedgerStore();
    const task = aLedgerRecord().withLedgerId('ledger-1').build();
    store.upsert(task);

    const reader = new LedgerReader(store);

    expect(reader.getByLedgerId('ledger-1')).toEqual(task);
  });

  it('gets a task by runtime and runKey', () => {
    const store = new InMemoryLedgerStore();
    const task = aLedgerRecord().withRuntime('cron').withRunKey('cron-run-1').build();
    store.upsert(task);

    const reader = new LedgerReader(store);

    expect(reader.getByRunKey('cron', 'cron-run-1')).toEqual(task);
  });

  it('lists running tasks', () => {
    const store = new InMemoryLedgerStore();
    const running = aLedgerRecord().withLedgerId('running').withStatus('running').build();
    const completed = aLedgerRecord()
      .withLedgerId('completed')
      .withRunKey('completed-run')
      .withStatus('succeeded')
      .build();
    store.upsert(running);
    store.upsert(completed);

    const reader = new LedgerReader(store);

    expect(reader.listRunning()).toEqual([running]);
  });

  it('lists tasks by runtime', () => {
    const store = new InMemoryLedgerStore();
    const cron = aLedgerRecord().withLedgerId('cron').withRuntime('cron').withRunKey('cron-run').build();
    const a2a = aLedgerRecord().withLedgerId('a2a').withRuntime('a2a').withRunKey('a2a-run').build();
    store.upsert(cron);
    store.upsert(a2a);

    const reader = new LedgerReader(store);

    expect(reader.listByRuntime('cron')).toEqual([cron]);
  });
});
