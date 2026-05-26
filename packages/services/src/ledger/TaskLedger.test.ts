import { describe, expect, it } from 'vitest';
import { InMemoryLedgerStore } from './InMemoryLedgerStore';
import { TaskLedger } from './TaskLedger';

describe('TaskLedger', () => {
  it('composes writer, reader, canceller, and owner scope surfaces', () => {
    const ledger = new TaskLedger(new InMemoryLedgerStore(), {
      createLedgerId: () => 'ledger-1',
      now: () => '2026-05-21T00:00:00.000Z',
    });

    const task = ledger.writer.createRunning({
      runtime: 'local',
      ownerMindId: 'mind-a',
      scopeKind: 'system',
      task: 'Local work',
      payload: { runtime: 'local' },
    });

    expect(ledger.reader.getByLedgerId(task.ledgerId)).toEqual(task);
    expect(ledger.asOwnerScope('mind-a').getByLedgerId('mind-a:ledger-1')).toEqual(task);
    expect(ledger.canceller.cancel(task.ledgerId)).toMatchObject({
      found: true,
      cancelled: false,
      reason: 'Cancellation for local is not wired yet.',
    });
  });
});
