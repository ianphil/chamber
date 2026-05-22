import type { LedgerRecord, LedgerStatus, RuntimePayload, TaskRuntime } from '@chamber/shared';

const DEFAULT_TIMESTAMP = '2026-05-21T00:00:00.000Z';

export class LedgerRecordBuilder {
  private record: LedgerRecord = {
    ledgerId: 'ledger-1',
    runKey: 'run-1',
    sourceId: 'source-1',
    runtime: 'cron',
    ownerMindId: 'mind-1',
    scopeKind: 'system',
    task: 'Run cron job',
    status: 'running',
    notifyPolicy: 'silent',
    deliveryStatus: 'not-applicable',
    createdAt: DEFAULT_TIMESTAMP,
    lastEventAt: DEFAULT_TIMESTAMP,
    payload: { runtime: 'cron', kind: 'prompt' },
  };

  forMind(ownerMindId: string): this {
    this.record = { ...this.record, ownerMindId };
    return this;
  }

  running(): this {
    this.record = { ...this.record, status: 'running' };
    return this;
  }

  withLedgerId(ledgerId: string): this {
    this.record = { ...this.record, ledgerId };
    return this;
  }

  withRunKey(runKey: string): this {
    this.record = { ...this.record, runKey };
    return this;
  }

  withRuntime(runtime: TaskRuntime): this {
    this.record = { ...this.record, runtime, payload: defaultPayloadFor(runtime) };
    return this;
  }

  withStatus(status: LedgerStatus): this {
    this.record = { ...this.record, status };
    return this;
  }

  build(): LedgerRecord {
    return { ...this.record };
  }
}

export function aLedgerRecord(): LedgerRecordBuilder {
  return new LedgerRecordBuilder();
}

function defaultPayloadFor(runtime: TaskRuntime): RuntimePayload {
  switch (runtime) {
    case 'cron':
      return { runtime: 'cron', kind: 'prompt' };
    case 'a2a':
      return { runtime: 'a2a', a2aTaskId: 'a2a-task-1', contextId: 'context-1' };
    case 'acp-child':
      return { runtime: 'acp-child', rawJobId: 'raw-job-1', cwd: 'C:\\src\\chamber' };
    case 'chatroom':
      return { runtime: 'chatroom', strategy: 'concurrent' };
    case 'local':
      return { runtime: 'local' };
    default: {
      const _exhaustive: never = runtime;
      throw new Error(`Unknown runtime: ${String(_exhaustive)}`);
    }
  }
}
