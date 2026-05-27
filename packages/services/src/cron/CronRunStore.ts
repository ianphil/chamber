import { Task, TaskResult, TaskStatus, type Store, type TaskMetadata } from '@ianphil/ttasks-ts';
import type { LedgerRecord, LedgerStatus } from '@chamber/shared';
import type { CronJob, CronJobRunRecord, CronJobType, CronRunStatus, RunSource } from './types';

const CRON_TASK_TYPE_PREFIX = 'cron:';
const IMPORT_TIMESTAMP_TOLERANCE_MS = 1_000;

type CronTaskMetadata = TaskMetadata & {
  runtime: 'cron';
  ownerMindId: string;
  scopeKind: 'system';
  sourceId: string;
  label: RunSource;
  kind: CronJobType;
  cronStatus: CronRunStatus;
  startedAt: string;
  endedAt: string;
  externalTaskId?: string;
};

export interface CronRunStore {
  listRuns(mindId: string, jobId?: string): CronJobRunRecord[];
  hasRun(runId: string): boolean;
  hasActiveRun(mindId: string, jobId: string): boolean;
  recordRun(run: Omit<CronJobRunRecord, 'id'>, job?: CronJob): CronJobRunRecord;
  importRun(run: CronJobRunRecord, job?: CronJob): void;
}

export class TTasksCronRunStore implements CronRunStore {
  constructor(private readonly store: Store) {}

  listRuns(mindId: string, jobId?: string): CronJobRunRecord[] {
    return [...this.store.tasks.values()]
      .map((task) => this.toCronRunRecord(task))
      .filter((run): run is CronJobRunRecord => run !== null)
      .filter((run) => run.mindId === mindId)
      .filter((run) => !jobId || run.jobId === jobId)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  }

  hasRun(runId: string): boolean {
    return this.store.tasks.has(runId);
  }

  hasActiveRun(mindId: string, jobId: string): boolean {
    for (const task of this.store.tasks.values()) {
      const metadata = getCronMetadata(task);
      if (!metadata) continue;
      if (metadata.ownerMindId === mindId && metadata.sourceId === jobId && task.isActive) {
        return true;
      }
    }
    return false;
  }

  recordRun(run: Omit<CronJobRunRecord, 'id'>, job?: CronJob): CronJobRunRecord {
    const task = this.buildTask(run, job);
    this.store.tasks.save(task);
    const record = this.toCronRunRecord(task);
    if (!record) {
      throw new Error(`Failed to persist cron run for job ${run.jobId}`);
    }
    return record;
  }

  importRun(run: CronJobRunRecord, job?: CronJob): void {
    if (this.hasRun(run.id) || this.hasEquivalentRun(run)) return;
    const task = this.buildTask(run, job, run.id);
    this.store.tasks.save(task);
  }

  private hasEquivalentRun(run: CronJobRunRecord): boolean {
    return this.listRuns(run.mindId, run.jobId).some((existing) => isEquivalentRun(existing, run));
  }

  private buildTask(
    run: Omit<CronJobRunRecord, 'id'>,
    job?: CronJob,
    id?: string,
  ): Task {
    const startedAt = new Date(run.startedAt);
    const endedAt = new Date(run.endedAt);
    const terminalStatus = toTaskStatus(run.status);
    const task = Task.custom(`${CRON_TASK_TYPE_PREFIX}${run.type}`, '', {
      id,
      title: job?.name ?? `Cron job ${run.jobId}`,
      description: run.source,
      createdAt: startedAt,
      metadata: {
        runtime: 'cron',
        ownerMindId: run.mindId,
        scopeKind: 'system',
        sourceId: run.jobId,
        label: run.source,
        kind: run.type,
        cronStatus: run.status,
        startedAt: run.startedAt,
        endedAt: run.endedAt,
        ...(run.taskId ? { externalTaskId: run.taskId } : {}),
      } satisfies CronTaskMetadata,
    });
    const result = new TaskResult({
      taskId: task.id,
      status: terminalStatus,
      startedAt,
      finishedAt: endedAt,
      duration: Math.max(0, endedAt.getTime() - startedAt.getTime()),
      output: run.output ?? '',
      error: run.error ?? null,
      raw: null,
      returncode: null,
      terminationReason: toTerminationReason(run.status),
    });
    task.transitionTo(TaskStatus.RUNNING);
    task.transitionTo(terminalStatus, {
      result,
      error: run.error,
    });
    return task;
  }

  private toCronRunRecord(task: Task): CronJobRunRecord | null {
    const metadata = getCronMetadata(task);
    if (!metadata) return null;
    const result = task.result;
    return {
      id: task.id,
      jobId: metadata.sourceId,
      mindId: metadata.ownerMindId,
      type: metadata.kind,
      status: metadata.cronStatus,
      startedAt: metadata.startedAt,
      endedAt: metadata.endedAt,
      taskId: metadata.externalTaskId,
      output: result?.output || undefined,
      error: task.error ?? result?.error ?? undefined,
      source: metadata.label,
    };
  }
}

export function ledgerRecordToCronRunRecord(
  record: LedgerRecord,
  jobsById: ReadonlyMap<string, CronJob>,
): CronJobRunRecord | null {
  if (record.payload.runtime !== 'cron' || !record.sourceId) return null;
  const job = jobsById.get(record.sourceId);
  return {
    id: record.ledgerId,
    jobId: record.sourceId,
    mindId: record.ownerMindId,
    type: job?.type ?? record.payload.kind,
    status: toCronRunStatus(record.status, record.terminalSummary),
    startedAt: record.startedAt ?? record.createdAt,
    endedAt: record.endedAt ?? record.lastEventAt ?? record.startedAt ?? record.createdAt,
    output: record.progressSummary,
    error: record.error,
    source: toRunSource(record.label),
  };
}

function getCronMetadata(task: Task): CronTaskMetadata | null {
  const metadata = task.metadata;
  if (metadata.runtime !== 'cron') return null;
  if (
    typeof metadata.ownerMindId !== 'string'
    || metadata.scopeKind !== 'system'
    || typeof metadata.sourceId !== 'string'
    || !isRunSource(metadata.label)
    || !isCronJobType(metadata.kind)
    || !isCronRunStatus(metadata.cronStatus)
    || typeof metadata.startedAt !== 'string'
    || typeof metadata.endedAt !== 'string'
  ) {
    return null;
  }
  if (metadata.externalTaskId !== undefined && typeof metadata.externalTaskId !== 'string') {
    return null;
  }
  return metadata as CronTaskMetadata;
}

function toTaskStatus(status: CronRunStatus): TaskStatus.SUCCEEDED | TaskStatus.FAILED | TaskStatus.CANCELLED {
  switch (status) {
    case 'completed':
      return TaskStatus.SUCCEEDED;
    case 'failed':
    case 'timed-out':
      return TaskStatus.FAILED;
    case 'skipped':
      return TaskStatus.CANCELLED;
  }
}

function toTerminationReason(status: CronRunStatus): 'handler' | 'timeout' | 'cancelled' | null {
  switch (status) {
    case 'completed':
      return null;
    case 'failed':
      return 'handler';
    case 'timed-out':
      return 'timeout';
    case 'skipped':
      return 'cancelled';
  }
}

function toRunSource(label: string | undefined): RunSource {
  return isRunSource(label) ? label : 'scheduled';
}

function isEquivalentRun(left: CronJobRunRecord, right: CronJobRunRecord): boolean {
  return left.mindId === right.mindId
    && left.jobId === right.jobId
    && left.type === right.type
    && left.status === right.status
    && left.source === right.source
    && normalizeString(left.output) === normalizeString(right.output)
    && normalizeString(left.error) === normalizeString(right.error)
    && isCloseTimestamp(left.startedAt, right.startedAt)
    && isCloseTimestamp(left.endedAt, right.endedAt);
}

function normalizeString(value: string | undefined): string {
  return value ?? '';
}

function isCloseTimestamp(left: string, right: string): boolean {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) return left === right;
  return Math.abs(leftTime - rightTime) <= IMPORT_TIMESTAMP_TOLERANCE_MS;
}

function toCronRunStatus(status: LedgerStatus, terminalSummary?: string): CronRunStatus {
  if (terminalSummary === 'skipped') return 'skipped';
  switch (status) {
    case 'succeeded':
      return 'completed';
    case 'failed':
    case 'lost':
      return 'failed';
    case 'timed-out':
      return 'timed-out';
    case 'cancelled':
      return 'skipped';
    case 'queued':
    case 'running':
      return 'failed';
  }
}

function isRunSource(value: unknown): value is RunSource {
  return value === 'manual' || value === 'resume' || value === 'scheduled';
}

function isCronRunStatus(value: unknown): value is CronRunStatus {
  return value === 'completed' || value === 'failed' || value === 'timed-out' || value === 'skipped';
}

function isCronJobType(value: unknown): value is CronJobType {
  return value === 'prompt' || value === 'shell' || value === 'webhook' || value === 'notification';
}
