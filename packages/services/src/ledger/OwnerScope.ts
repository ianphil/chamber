import type { CancelOutcome, LedgerRecord } from '@chamber/shared';
import type { LedgerCanceller } from './LedgerCanceller';
import type { LedgerReader } from './LedgerReader';

const SCOPED_ID_SEPARATOR = ':';

type Canceller = Pick<LedgerCanceller, 'cancel'>;

export class OwnerScope {
  constructor(
    private readonly ownerMindId: string,
    private readonly reader: LedgerReader,
    private readonly canceller: Canceller,
  ) {}

  getByLedgerId(scopedLedgerId: string): LedgerRecord {
    const ledgerId = this.unscope(scopedLedgerId);
    const task = this.reader.getByLedgerId(ledgerId);
    if (!task || task.ownerMindId !== this.ownerMindId) {
      throw unknownJob(scopedLedgerId);
    }
    return task;
  }

  cancelByLedgerId(scopedLedgerId: string): CancelOutcome {
    let task: LedgerRecord;
    try {
      task = this.getByLedgerId(scopedLedgerId);
    } catch (err) {
      if (err instanceof Error && err.message === `Unknown job_id: ${scopedLedgerId}`) {
        return { found: false, cancelled: false, reason: err.message };
      }
      throw err;
    }

    return this.canceller.cancel(task.ledgerId);
  }

  scopeLedgerId(ledgerId: string): string {
    return `${this.ownerMindId}${SCOPED_ID_SEPARATOR}${ledgerId}`;
  }

  private unscope(scopedLedgerId: string): string {
    if (typeof scopedLedgerId !== 'string' || scopedLedgerId.length === 0) {
      throw unknownJob(scopedLedgerId);
    }

    const sep = scopedLedgerId.lastIndexOf(SCOPED_ID_SEPARATOR);
    if (sep <= 0 || sep === scopedLedgerId.length - 1) {
      throw unknownJob(scopedLedgerId);
    }

    const prefix = scopedLedgerId.slice(0, sep);
    const ledgerId = scopedLedgerId.slice(sep + 1);
    if (prefix !== this.ownerMindId) {
      throw unknownJob(scopedLedgerId);
    }
    return ledgerId;
  }
}

function unknownJob(scopedLedgerId: string): Error {
  return new Error(`Unknown job_id: ${scopedLedgerId}`);
}
