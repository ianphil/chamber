import { LedgerCanceller } from './LedgerCanceller';
import { LedgerReader } from './LedgerReader';
import type { LedgerStore } from './LedgerStore';
import { LedgerWriter, type LedgerWriterDependencies } from './LedgerWriter';
import { OwnerScope } from './OwnerScope';

export class TaskLedger {
  readonly writer: LedgerWriter;
  readonly reader: LedgerReader;
  readonly canceller: LedgerCanceller;

  constructor(
    store: LedgerStore,
    writerDependencies?: LedgerWriterDependencies,
  ) {
    this.writer = new LedgerWriter(store, writerDependencies);
    this.reader = new LedgerReader(store);
    this.canceller = new LedgerCanceller(store);
  }

  asOwnerScope(ownerMindId: string): OwnerScope {
    return new OwnerScope(ownerMindId, this.reader, this.canceller);
  }
}
