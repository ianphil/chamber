import type { LedgerRecord } from '@chamber/shared';
import type { LedgerStore } from './LedgerStore';
import { LedgerWriter } from './LedgerWriter';

export interface LedgerSweeperOptions {
  readonly staleAfterMs?: number;
  readonly now?: () => string;
}

export interface SweepResult {
  readonly scanned: number;
  readonly markedLost: number;
}

export class LedgerSweeper {
  private readonly staleAfterMs: number;
  private readonly now: () => string;
  private readonly writer: LedgerWriter;

  constructor(
    private readonly store: LedgerStore,
    options: LedgerSweeperOptions = {},
  ) {
    this.staleAfterMs = options.staleAfterMs ?? 24 * 60 * 60 * 1000;
    this.now = options.now ?? (() => new Date().toISOString());
    this.writer = new LedgerWriter(store, {
      createLedgerId: () => {
        throw new Error('LedgerSweeper never creates records');
      },
      now: this.now,
    });
  }

  sweep(): SweepResult {
    const threshold = Date.parse(this.now()) - this.staleAfterMs;
    const stale = this.store.listByStatus('running').filter((record) => this.isStale(record, threshold));
    for (const record of stale) {
      this.writer.finalize(record.ledgerId, {
        status: 'lost',
        terminalSummary: 'lost',
        error: 'Marked lost after stale running sweep.',
      });
    }
    return { scanned: stale.length, markedLost: stale.length };
  }

  private isStale(record: LedgerRecord, threshold: number): boolean {
    return !!record.lastEventAt && Date.parse(record.lastEventAt) < threshold;
  }
}
