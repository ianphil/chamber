import type { CancelOutcome, LedgerRecord, TaskRuntime } from '@chamber/shared';

export type RuntimeCancelHandler = (task: LedgerRecord) => Promise<CancelOutcome> | CancelOutcome;

export type RuntimeCancelHandlers = Partial<Record<TaskRuntime, RuntimeCancelHandler>>;

export function createEmptyRuntimeCancelHandlers(): RuntimeCancelHandlers {
  return {};
}
