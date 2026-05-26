import type { CancelOutcome, LedgerRecord } from '@chamber/shared';
import type { LedgerStore } from './LedgerStore';
import { LedgerPolicy } from './LedgerPolicy';

export class LedgerCanceller {
  constructor(
    private readonly store: LedgerStore,
    private readonly policy = new LedgerPolicy(),
  ) {}

  cancel(ledgerId: string): CancelOutcome {
    const task = this.store.findByLedgerId(ledgerId);
    if (!task) {
      return {
        found: false,
        cancelled: false,
        reason: `Ledger record not found: ${ledgerId}`,
      };
    }

    if (this.policy.isTerminal(task.status)) {
      return {
        found: true,
        cancelled: false,
        reason: `Task is already terminal: ${task.status}`,
        task,
      };
    }

    return this.cancelByRuntime(task);
  }

  private cancelByRuntime(task: LedgerRecord): CancelOutcome {
    switch (task.runtime) {
      case 'cron':
        return {
          found: true,
          cancelled: false,
          reason: 'Cron run cannot be cancelled; remove the schedule instead.',
          task,
        };
      case 'a2a':
      case 'acp-child':
      case 'chatroom':
      case 'local':
        return {
          found: true,
          cancelled: false,
          reason: `Cancellation for ${task.runtime} is not wired yet.`,
          task,
        };
      default: {
        const _exhaustive: never = task.runtime;
        throw new Error(`Unknown task runtime: ${String(_exhaustive)}`);
      }
    }
  }
}
