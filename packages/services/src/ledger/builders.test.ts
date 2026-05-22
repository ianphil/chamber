import { describe, expect, it } from 'vitest';
import { aLedgerRecord } from './builders';

describe('aLedgerRecord', () => {
  it('builds a valid default LedgerRecord', () => {
    expect(aLedgerRecord().build()).toMatchObject({
      ledgerId: 'ledger-1',
      ownerMindId: 'mind-1',
      runtime: 'cron',
      status: 'running',
      payload: { runtime: 'cron', kind: 'prompt' },
    });
  });

  it('updates owner, runtime, runKey, and status fluently', () => {
    expect(
      aLedgerRecord()
        .forMind('mind-2')
        .withLedgerId('ledger-2')
        .withRunKey('run-2')
        .withRuntime('a2a')
        .withStatus('succeeded')
        .build(),
    ).toMatchObject({
      ledgerId: 'ledger-2',
      runKey: 'run-2',
      ownerMindId: 'mind-2',
      runtime: 'a2a',
      status: 'succeeded',
      payload: { runtime: 'a2a', a2aTaskId: 'a2a-task-1', contextId: 'context-1' },
    });
  });
});
