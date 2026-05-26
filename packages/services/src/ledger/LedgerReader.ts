import type { LedgerRecord, TaskRuntime } from '@chamber/shared';
import type { LedgerStore } from './LedgerStore';

export class LedgerReader {
  constructor(private readonly store: LedgerStore) {}

  getByLedgerId(ledgerId: string): LedgerRecord | undefined {
    return this.store.findByLedgerId(ledgerId);
  }

  getByRunKey(runtime: TaskRuntime, runKey: string): LedgerRecord | undefined {
    return this.store.findByRunKey(runtime, runKey);
  }

  listByRuntime(runtime: TaskRuntime): LedgerRecord[] {
    return this.store.listByRuntime(runtime);
  }

  listRunning(): LedgerRecord[] {
    return this.store.listByStatus('running');
  }
}
