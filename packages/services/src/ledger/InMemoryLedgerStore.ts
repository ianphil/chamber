import type { LedgerRecord, LedgerStatus, TaskRuntime } from '@chamber/shared';
import { LedgerDataError } from './errors';
import type { LedgerStore } from './LedgerStore';

export class InMemoryLedgerStore implements LedgerStore {
  private readonly records = new Map<string, LedgerRecord>();

  upsert(record: LedgerRecord): void {
    if (record.runKey) {
      const duplicate = this.findByRunKey(record.runtime, record.runKey);
      if (duplicate && duplicate.ledgerId !== record.ledgerId) {
        throw new LedgerDataError(`Duplicate ledger runKey for runtime ${record.runtime}: ${record.runKey}`);
      }
    }
    this.records.set(record.ledgerId, { ...record });
  }

  findByLedgerId(ledgerId: string): LedgerRecord | undefined {
    const record = this.records.get(ledgerId);
    return record ? { ...record } : undefined;
  }

  findByRunKey(runtime: TaskRuntime, runKey: string): LedgerRecord | undefined {
    for (const record of this.records.values()) {
      if (record.runtime === runtime && record.runKey === runKey) {
        return { ...record };
      }
    }
    return undefined;
  }

  listByRuntime(runtime: TaskRuntime): LedgerRecord[] {
    return Array.from(this.records.values())
      .filter((record) => record.runtime === runtime)
      .map((record) => ({ ...record }));
  }

  listByStatus(status: LedgerStatus): LedgerRecord[] {
    return Array.from(this.records.values())
      .filter((record) => record.status === status)
      .map((record) => ({ ...record }));
  }

  deleteByLedgerId(ledgerId: string): boolean {
    return this.records.delete(ledgerId);
  }
}
