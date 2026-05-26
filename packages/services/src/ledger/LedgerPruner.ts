import type { LedgerStore } from './LedgerStore';

export interface PruneResult {
  readonly scanned: number;
  readonly deleted: number;
}

export class LedgerPruner {
  constructor(
    private readonly store: LedgerStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  pruneExpired(): PruneResult {
    const now = Date.parse(this.now());
    const terminal = ['succeeded', 'failed', 'timed-out', 'cancelled', 'lost'] as const;
    const expired = terminal
      .flatMap((status) => this.store.listByStatus(status))
      .filter((record) => record.cleanupAfter && Date.parse(record.cleanupAfter) <= now);
    let deleted = 0;
    for (const record of expired) {
      if (this.store.deleteByLedgerId(record.ledgerId)) deleted += 1;
    }
    return { scanned: expired.length, deleted };
  }
}
