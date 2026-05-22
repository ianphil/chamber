import { describe, expect, it, vi } from 'vitest';
import { InMemoryLedgerStore } from './InMemoryLedgerStore';
import { LedgerWriter } from './LedgerWriter';
import { safelyRecordRun } from './safelyRecordRun';

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

const runInput = {
  runtime: 'local',
  ownerMindId: 'mind-1',
  scopeKind: 'system',
  task: 'Local work',
  payload: { runtime: 'local' },
} as const;

describe('safelyRecordRun', () => {
  it('creates, runs, and completes a successful run', async () => {
    const { store, writer } = createWriter();

    const result = await safelyRecordRun(writer, runInput, async (task) => `done:${task?.ledgerId}`);

    expect(result).toBe('done:ledger-1');
    expect(store.findByLedgerId('ledger-1')).toMatchObject({
      status: 'succeeded',
      endedAt: LATER,
    });
  });

  it('marks a run failed and rethrows the producer error', async () => {
    const { store, writer } = createWriter();
    const error = new Error('producer failed');

    await expect(safelyRecordRun(writer, runInput, async () => {
      throw error;
    })).rejects.toThrow(error);

    expect(store.findByLedgerId('ledger-1')).toMatchObject({
      status: 'failed',
      error: 'producer failed',
    });
  });

  it('still runs producer work when ledger creation fails', async () => {
    const writer = {
      createRunning: vi.fn(() => {
        throw new Error('ledger unavailable');
      }),
      complete: vi.fn(),
      fail: vi.fn(),
    };

    const result = await safelyRecordRun(writer, runInput, async (task) => {
      expect(task).toBeUndefined();
      return 'producer result';
    });

    expect(result).toBe('producer result');
    expect(writer.complete).not.toHaveBeenCalled();
    expect(writer.fail).not.toHaveBeenCalled();
  });

  it('still runs producer work when duplicate runKey creation is rejected', async () => {
    const { store, writer } = createWriter();
    writer.createRunning({ ...runInput, runKey: 'same-run' });

    const result = await safelyRecordRun(
      writer,
      { ...runInput, runKey: 'same-run' },
      async (task) => {
        expect(task).toBeUndefined();
        return 'duplicate work ran';
      },
    );

    expect(result).toBe('duplicate work ran');
    expect(store.listByStatus('running')).toHaveLength(1);
  });
});
