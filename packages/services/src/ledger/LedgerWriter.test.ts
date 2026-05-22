import { describe, expect, it } from 'vitest';
import { LedgerDataError } from './errors';
import { InMemoryLedgerStore } from './InMemoryLedgerStore';
import { LedgerWriter } from './LedgerWriter';

const NOW = '2026-05-21T20:37:00.000Z';
const LATER = '2026-05-21T20:38:00.000Z';

function createWriter(): { store: InMemoryLedgerStore; writer: LedgerWriter } {
  const store = new InMemoryLedgerStore();
  const timestamps = [NOW, LATER];
  let id = 0;
  const writer = new LedgerWriter(store, {
    createLedgerId: () => `ledger-${id += 1}`,
    now: () => timestamps.shift() ?? LATER,
  });
  return { store, writer };
}

describe('LedgerWriter', () => {
  it('creates a running ledger record', () => {
    const { store, writer } = createWriter();

    const created = writer.createRunning({
      runtime: 'cron',
      ownerMindId: 'mind-1',
      scopeKind: 'system',
      task: 'Run morning briefing',
      runKey: 'cron-run-1',
      sourceId: 'cron-job-1',
      payload: { runtime: 'cron', kind: 'prompt' },
    });

    expect(created).toMatchObject({
      ledgerId: 'ledger-1',
      runtime: 'cron',
      ownerMindId: 'mind-1',
      scopeKind: 'system',
      task: 'Run morning briefing',
      runKey: 'cron-run-1',
      sourceId: 'cron-job-1',
      status: 'running',
      notifyPolicy: 'silent',
      deliveryStatus: 'not-applicable',
      createdAt: NOW,
      startedAt: NOW,
      lastEventAt: NOW,
      payload: { runtime: 'cron', kind: 'prompt' },
    });
    expect(store.findByLedgerId('ledger-1')).toEqual(created);
  });

  it('rejects a duplicate runtime/runKey', () => {
    const { writer } = createWriter();
    writer.createRunning({
      runtime: 'cron',
      ownerMindId: 'mind-1',
      scopeKind: 'system',
      task: 'Run morning briefing',
      runKey: 'cron-run-1',
      payload: { runtime: 'cron', kind: 'prompt' },
    });

    expect(() => writer.createRunning({
      runtime: 'cron',
      ownerMindId: 'mind-1',
      scopeKind: 'system',
      task: 'Run morning briefing again',
      runKey: 'cron-run-1',
      payload: { runtime: 'cron', kind: 'prompt' },
    })).toThrow(LedgerDataError);
  });

  it('completes a running record', () => {
    const { writer } = createWriter();
    writer.createRunning({
      runtime: 'local',
      ownerMindId: 'mind-1',
      scopeKind: 'system',
      task: 'Local work',
      payload: { runtime: 'local' },
    });

    const completed = writer.complete('ledger-1', { terminalSummary: 'Done' });

    expect(completed).toMatchObject({
      status: 'succeeded',
      endedAt: LATER,
      lastEventAt: LATER,
      cleanupAfter: '2026-06-20T20:38:00.000Z',
      terminalSummary: 'Done',
    });
  });

  it('fails a running record', () => {
    const { writer } = createWriter();
    writer.createRunning({
      runtime: 'local',
      ownerMindId: 'mind-1',
      scopeKind: 'system',
      task: 'Local work',
      payload: { runtime: 'local' },
    });

    const failed = writer.fail('ledger-1', new Error('boom'));

    expect(failed).toMatchObject({
      status: 'failed',
      endedAt: LATER,
      lastEventAt: LATER,
      error: 'boom',
    });
  });

  it('leaves terminal records unchanged when finalized again', () => {
    const { writer } = createWriter();
    writer.createRunning({
      runtime: 'local',
      ownerMindId: 'mind-1',
      scopeKind: 'system',
      task: 'Local work',
      payload: { runtime: 'local' },
    });
    const completed = writer.complete('ledger-1', { terminalSummary: 'Done' });

    const failed = writer.fail('ledger-1', new Error('too late'));

    expect(failed).toEqual(completed);
  });
});
