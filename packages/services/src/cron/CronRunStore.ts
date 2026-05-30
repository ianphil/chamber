import {
  Task,
  TaskResult,
  TaskStatus,
  type Store,
  type TaskGraph,
  type TaskMetadata,
} from '@ianphil/ttasks-ts';
import type {
  CronJob,
  CronJobRunRecord,
  CronRunDetail,
  CronRunDetailNode,
  CronRunStatus,
  RunSource,
} from './types';

/**
 * v2 cron run store. Each `CronJobRunRecord` is persisted as a ttasks
 * `Task` row in the mind's `.chamber/runs/ttasks.db`. The script's per-graph
 * task rows live in the same DB; `cron_run_detail(runId)` looks up the script
 * graph by its `graphId` and renders that graph's member tasks.
 */

const CRON_TASK_TYPE = 'cron:script';

type CronTaskMetadata = TaskMetadata & {
  runtime: 'cron';
  ownerMindId: string;
  scopeKind: 'system';
  sourceId: string;
  label: RunSource;
  cronStatus: CronRunStatus;
  startedAt: string;
  endedAt: string;
  graphId?: string;
};

export interface CronRunStore {
  listRuns(mindId: string, jobId?: string): CronJobRunRecord[];
  hasRun(runId: string): boolean;
  hasActiveRun(mindId: string, jobId: string): boolean;
  recordRun(run: Omit<CronJobRunRecord, 'id'>, job?: CronJob): CronJobRunRecord;
  getRunDetail(runId: string): CronRunDetail | null;
}

export class TTasksCronRunStore implements CronRunStore {
  constructor(private readonly store: Store) {}

  listRuns(mindId: string, jobId?: string): CronJobRunRecord[] {
    return [...this.store.tasks.values()]
      .map((task) => this.toRecord(task))
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
      const md = getCronMetadata(task);
      if (!md) continue;
      if (md.ownerMindId === mindId && md.sourceId === jobId && task.isActive) {
        return true;
      }
    }
    return false;
  }

  recordRun(run: Omit<CronJobRunRecord, 'id'>, job?: CronJob): CronJobRunRecord {
    const task = this.buildTask(run, job);
    this.store.tasks.save(task);
    const record = this.toRecord(task);
    if (!record) throw new Error(`Failed to persist cron run for job ${run.jobId}`);
    return record;
  }

  /**
   * Return a cron run plus the member tasks of the script graph it launched.
   * Allows `cron_run_detail` to render the per-task tree the script produced.
   *
   * ttasks records graph membership in its `graph_members` table, not in each
   * task's metadata, so we resolve the graph by id and enumerate its members
   * rather than scanning every task row for a `graphId` it does not carry.
   */
  getRunDetail(runId: string): CronRunDetail | null {
    const runTask = this.store.tasks.get(runId);
    if (!runTask) return null;
    const run = this.toRecord(runTask);
    if (!run) return null;
    const graphId = run.graphId;
    const graph: CronRunDetailNode[] = [];
    if (graphId) {
      const scriptGraph = this.safeGetGraph(graphId);
      if (scriptGraph) {
        for (const task of scriptGraph.tasks) {
          graph.push(toDetailNode(task));
        }
        graph.sort((a, b) => (a.startedAt ?? '').localeCompare(b.startedAt ?? ''));
      }
    }
    return { run, graph };
  }

  private safeGetGraph(graphId: string): TaskGraph | undefined {
    try {
      return this.store.graphs.get(graphId);
    } catch {
      return undefined;
    }
  }

  private buildTask(run: Omit<CronJobRunRecord, 'id'>, job?: CronJob): Task {
    const startedAt = new Date(run.startedAt);
    const endedAt = new Date(run.endedAt);
    const terminal = toTaskStatus(run.status);
    const metadata: CronTaskMetadata = {
      runtime: 'cron',
      ownerMindId: run.mindId,
      scopeKind: 'system',
      sourceId: run.jobId,
      label: run.source,
      cronStatus: run.status,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      ...(run.graphId ? { graphId: run.graphId } : {}),
    };
    const task = Task.custom(CRON_TASK_TYPE, '', {
      title: job?.name ?? `Cron job ${run.jobId}`,
      description: run.source,
      createdAt: startedAt,
      metadata,
    });
    const result = new TaskResult({
      taskId: task.id,
      status: terminal,
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
    task.transitionTo(terminal, { result, error: run.error });
    return task;
  }

  private toRecord(task: Task): CronJobRunRecord | null {
    const md = getCronMetadata(task);
    if (!md) return null;
    const result = task.result;
    return {
      id: task.id,
      jobId: md.sourceId,
      mindId: md.ownerMindId,
      status: md.cronStatus,
      startedAt: md.startedAt,
      endedAt: md.endedAt,
      ...(md.graphId ? { graphId: md.graphId } : {}),
      output: result?.output || undefined,
      error: task.error ?? result?.error ?? undefined,
      source: md.label,
    };
  }
}

function getCronMetadata(task: Task): CronTaskMetadata | null {
  const md = task.metadata;
  if (md.runtime !== 'cron') return null;
  if (
    typeof md.ownerMindId !== 'string'
    || md.scopeKind !== 'system'
    || typeof md.sourceId !== 'string'
    || !isRunSource(md.label)
    || !isCronRunStatus(md.cronStatus)
    || typeof md.startedAt !== 'string'
    || typeof md.endedAt !== 'string'
  ) {
    return null;
  }
  if (md.graphId !== undefined && typeof md.graphId !== 'string') return null;
  return md as CronTaskMetadata;
}

function toTaskStatus(
  status: CronRunStatus,
): TaskStatus.SUCCEEDED | TaskStatus.FAILED | TaskStatus.CANCELLED {
  switch (status) {
    case 'completed':
      return TaskStatus.SUCCEEDED;
    case 'failed':
    case 'timed-out':
      return TaskStatus.FAILED;
    case 'skipped':
    case 'canceled':
      return TaskStatus.CANCELLED;
  }
}

function toTerminationReason(
  status: CronRunStatus,
): 'handler' | 'timeout' | 'cancelled' | null {
  switch (status) {
    case 'completed':
      return null;
    case 'failed':
      return 'handler';
    case 'timed-out':
      return 'timeout';
    case 'skipped':
    case 'canceled':
      return 'cancelled';
  }
}

function isRunSource(value: unknown): value is RunSource {
  return value === 'manual' || value === 'resume' || value === 'scheduled';
}

function toDetailNode(task: Task): CronRunDetailNode {
  const md = task.metadata as Record<string, unknown>;
  const result = task.result;
  const parentId = typeof md.parentId === 'string' ? md.parentId : null;
  const node: CronRunDetailNode = {
    id: task.id,
    type: task.type ?? 'unknown',
    title: task.title ?? task.id,
    status: String(task.status),
    parentId,
  };
  if (result?.startedAt) node.startedAt = result.startedAt.toISOString();
  if (result?.finishedAt) node.finishedAt = result.finishedAt.toISOString();
  if (typeof result?.duration === 'number') node.durationMs = result.duration;
  if (result?.output) node.output = String(result.output).slice(0, 4096);
  const err = task.error ?? result?.error ?? null;
  if (err) node.error = String(err).slice(0, 4096);
  return node;
}

function isCronRunStatus(value: unknown): value is CronRunStatus {
  return (
    value === 'completed'
    || value === 'failed'
    || value === 'timed-out'
    || value === 'skipped'
    || value === 'canceled'
  );
}
