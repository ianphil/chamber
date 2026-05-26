import type { LedgerStatus } from '@chamber/shared';

const TERMINAL_STATUSES = new Set<LedgerStatus>([
  'succeeded',
  'failed',
  'timed-out',
  'cancelled',
  'lost',
]);

export class LedgerPolicy {
  isTerminal(status: LedgerStatus): boolean {
    return TERMINAL_STATUSES.has(status);
  }
}
