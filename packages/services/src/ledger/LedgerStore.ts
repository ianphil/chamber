import type { LedgerRecord, LedgerStatus, TaskRuntime } from '@chamber/shared';

export interface LedgerStore {
  upsert(record: LedgerRecord): void;
  findByLedgerId(ledgerId: string): LedgerRecord | undefined;
  findByRunKey(runtime: TaskRuntime, runKey: string): LedgerRecord | undefined;
  listByRuntime(runtime: TaskRuntime): LedgerRecord[];
  listByStatus(status: LedgerStatus): LedgerRecord[];
  deleteByLedgerId(ledgerId: string): boolean;
}
