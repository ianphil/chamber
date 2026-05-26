import { randomUUID } from 'node:crypto';
import type {
  DeliveryStatus,
  LedgerRecord,
  LedgerStatus,
  NotifyPolicy,
  RuntimePayload,
  ScopeKind,
  TaskRuntime,
} from '@chamber/shared';
import type { LedgerStore } from './LedgerStore';
import { LedgerPolicy } from './LedgerPolicy';

const DEFAULT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface LedgerWriterClock {
  now(): string;
}

export interface LedgerWriterIdFactory {
  createLedgerId(): string;
}

export interface LedgerWriterDependencies extends LedgerWriterClock, LedgerWriterIdFactory {}

export interface CreateRunningInput {
  runtime: TaskRuntime;
  ownerMindId: string;
  scopeKind: ScopeKind;
  task: string;
  payload: RuntimePayload;
  runKey?: string;
  sourceId?: string;
  parentLedgerId?: string;
  label?: string;
  a2aTaskId?: string;
  contextId?: string;
  notifyPolicy?: NotifyPolicy;
  deliveryStatus?: DeliveryStatus;
}

export interface CompleteInput {
  terminalSummary?: string;
  progressSummary?: string;
  error?: string;
}

export interface FinalizeInput extends CompleteInput {
  status: Extract<LedgerStatus, 'succeeded' | 'failed' | 'timed-out' | 'cancelled' | 'lost'>;
}

export class LedgerWriter {
  constructor(
    private readonly store: LedgerStore,
    private readonly dependencies: LedgerWriterDependencies = {
      createLedgerId: randomUUID,
      now: () => new Date().toISOString(),
    },
    private readonly policy = new LedgerPolicy(),
  ) {}

  createRunning(input: CreateRunningInput): LedgerRecord {
    this.assertPayloadMatchesRuntime(input.runtime, input.payload);

    const now = this.dependencies.now();
    const record: LedgerRecord = {
      ledgerId: this.dependencies.createLedgerId(),
      runKey: input.runKey,
      sourceId: input.sourceId,
      runtime: input.runtime,
      ownerMindId: input.ownerMindId,
      scopeKind: input.scopeKind,
      parentLedgerId: input.parentLedgerId,
      a2aTaskId: input.a2aTaskId,
      contextId: input.contextId,
      label: input.label,
      task: input.task,
      status: 'running',
      notifyPolicy: input.notifyPolicy ?? 'silent',
      deliveryStatus: input.deliveryStatus ?? 'not-applicable',
      createdAt: now,
      startedAt: now,
      lastEventAt: now,
      payload: input.payload,
    };
    this.store.upsert(record);
    return record;
  }

  complete(ledgerId: string, input: CompleteInput = {}): LedgerRecord {
    return this.finalize(ledgerId, { status: 'succeeded', ...input });
  }

  finalize(ledgerId: string, input: FinalizeInput): LedgerRecord {
    const record = this.requireRecord(ledgerId);
    if (this.isTerminal(record)) return record;

    const now = this.dependencies.now();
    const finalized: LedgerRecord = {
      ...record,
      status: input.status,
      endedAt: now,
      lastEventAt: now,
      cleanupAfter: record.cleanupAfter ?? new Date(Date.parse(now) + DEFAULT_RETENTION_MS).toISOString(),
      terminalSummary: input.terminalSummary,
      progressSummary: input.progressSummary,
      error: input.error,
    };
    this.store.upsert(finalized);
    return finalized;
  }

  fail(ledgerId: string, error: Error | string): LedgerRecord {
    const record = this.requireRecord(ledgerId);
    if (this.isTerminal(record)) return record;

    return this.finalize(ledgerId, {
      status: 'failed',
      error: typeof error === 'string' ? error : error.message,
    });
  }

  private requireRecord(ledgerId: string): LedgerRecord {
    const record = this.store.findByLedgerId(ledgerId);
    if (!record) throw new Error(`Ledger record not found: ${ledgerId}`);
    return record;
  }

  private isTerminal(record: LedgerRecord): boolean {
    return this.policy.isTerminal(record.status);
  }

  private assertPayloadMatchesRuntime(runtime: TaskRuntime, payload: RuntimePayload): void {
    if (payload.runtime !== runtime) {
      throw new Error(`Ledger payload runtime ${payload.runtime} does not match record runtime ${runtime}`);
    }
  }
}
