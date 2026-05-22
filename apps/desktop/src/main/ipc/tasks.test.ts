import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { IPC } from '@chamber/shared';
import { aLedgerRecord, InMemoryLedgerStore, TaskLedger } from '@chamber/services';
import { setupTasksIPC } from './tasks';

const EVT = {} as IpcMainInvokeEvent;
type InvokeHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

function getHandler(name: string): InvokeHandler {
  const call = vi.mocked(ipcMain.handle).mock.calls.find((c) => c[0] === name);
  if (!call) throw new Error(`no handler registered for ${name}`);
  return call[1] as InvokeHandler;
}

describe('Tasks IPC', () => {
  let ledger: TaskLedger;
  let store: InMemoryLedgerStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new InMemoryLedgerStore();
    ledger = new TaskLedger(store);
    setupTasksIPC({ getLedgerForMind: () => ledger });
  });

  it('tasks:list returns ledger rows for the requested mind only', async () => {
    const mine = aLedgerRecord().withLedgerId('mine').withRuntime('cron').forMind('mind-1').build();
    const theirs = aLedgerRecord().withLedgerId('theirs').withRuntime('a2a').forMind('mind-2').withRunKey('a2a-run').build();
    store.upsert(mine);
    store.upsert(theirs);

    await expect(getHandler(IPC.TASKS.LIST)(EVT, 'mind-1')).resolves.toEqual([mine]);
  });

  it('tasks:get hides another mind row with the Unknown shape', async () => {
    const theirs = aLedgerRecord().withLedgerId('theirs').forMind('mind-2').build();
    store.upsert(theirs);

    await expect(getHandler(IPC.TASKS.GET)(EVT, 'mind-1', 'theirs')).resolves.toEqual({
      error: 'Unknown task_id: theirs',
    });
  });

  it('tasks:cancel routes through the owner-scoped canceller', async () => {
    const row = ledger.writer.createRunning({
      runtime: 'local',
      ownerMindId: 'mind-1',
      scopeKind: 'system',
      task: 'cancel me',
      payload: { runtime: 'local' },
    });

    await expect(getHandler(IPC.TASKS.CANCEL)(EVT, 'mind-1', row.ledgerId)).resolves.toMatchObject({
      found: true,
      cancelled: false,
      reason: 'Cancellation for local is not wired yet.',
    });
  });

  it('tasks:audit returns status counts and typed findings', async () => {
    store.upsert({
      ...aLedgerRecord()
      .withLedgerId('stale')
      .forMind('mind-1')
      .withStatus('running')
      .build(),
      lastEventAt: '2026-05-19T00:00:00.000Z',
    });
    store.upsert({
      ...aLedgerRecord()
      .withLedgerId('failed-delivery')
      .forMind('mind-1')
      .withRunKey('failed-delivery')
      .withStatus('succeeded')
      .build(),
      deliveryStatus: 'failed',
    });

    const audit = await getHandler(IPC.TASKS.AUDIT)(EVT, 'mind-1');

    expect(audit).toMatchObject({
      counts: { running: 1, succeeded: 1 },
      findings: expect.arrayContaining([
        { type: 'stale-running', ledgerId: 'stale' },
        { type: 'missing-cleanup', ledgerId: 'failed-delivery' },
        { type: 'delivery-failed', ledgerId: 'failed-delivery' },
      ]),
    });
  });
});
