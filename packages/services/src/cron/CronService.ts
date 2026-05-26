import { Cron } from 'croner';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { LedgerRecord, LedgerStatus } from '@chamber/shared';
import type { ChamberToolProvider } from '../chamberTools';
import type { Tool } from '../mind/types';
import type { Notifier } from '../ports';
import { Logger } from '../logger';
import { LedgerDataError, safelyRecordRun, SQLiteLedgerStore, TaskLedger } from '../ledger';

const log = Logger.create('cron');
import type { TaskManager } from '../a2a/TaskManager';
import { JobStore } from './JobStore';
import { JobRunner } from './JobRunner';
import { Scheduler, validateSchedule } from './Scheduler';
import { buildCronTools } from './tools';
import type { CreateCronJobInput, CronJob, CronJobListEntry, CronJobPayload, CronJobRunRecord, CronJobType, CronRunStatus, RunSource } from './types';

function requireString(payload: Record<string, unknown>, field: string, jobType: string): void {
  if (typeof payload[field] !== 'string' || (payload[field] as string).trim() === '') {
    throw new Error(`${jobType} job payload requires a non-empty "${field}" string`);
  }
}

function pathExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

function fsRenameMigrated(filePath: string): void {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.renameSync(filePath, `${filePath}.migrated-${stamp}`);
}

function requirePayload(type: CronJobType, payload: CronJobPayload): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`cron_create requires payload for ${type} jobs`);
  }
  return payload as unknown as Record<string, unknown>;
}

function validatePayload(type: CronJobType, payload: CronJobPayload): void {
  const p = requirePayload(type, payload);
  switch (type) {
    case 'prompt':
      requireString(p, 'prompt', 'prompt');
      break;
    case 'shell':
      requireString(p, 'command', 'shell');
      break;
    case 'webhook':
      requireString(p, 'url', 'webhook');
      break;
    case 'notification':
      requireString(p, 'title', 'notification');
      requireString(p, 'body', 'notification');
      break;
  }
}

interface CronServiceOptions {
  getTaskManager: () => TaskManager;
  showMind: (mindId: string) => void;
  notifier: Notifier;
  createTaskLedger?: (mindPath: string) => TaskLedger;
}

// TODO: Consider extracting execution coordination (runJob, inFlightJobs,
// handlePowerResume) into a dedicated CronExecutor to improve SRP adherence.
// See: https://github.com/ianphil/chamber/issues/TBD
export class CronService implements ChamberToolProvider {
  private readonly stores = new Map<string, JobStore>();
  private readonly schedulers = new Map<string, Scheduler>();
  private readonly ledgers = new Map<string, TaskLedger>();
  private readonly mindPaths = new Map<string, string>();
  private readonly inFlightJobs = new Set<string>();
  private readonly runner: JobRunner;

  constructor(private readonly options: CronServiceOptions) {
    this.runner = new JobRunner(options);
  }

  getToolsForMind(mindId: string, mindPath: string): Tool[] {
    return buildCronTools(mindId, mindPath, this) as Tool[];
  }

  async activateMind(mindId: string, mindPath: string): Promise<void> {
    const store = this.ensureStore(mindId, mindPath);
    if (pathExists(this.getLegacyRunsPath(mindPath))) {
      const ledger = this.ensureLedger(mindId, mindPath);
      this.importLegacyRuns(mindId, mindPath, store, ledger);
    }
    const scheduler = this.ensureScheduler(mindId);

    for (const job of store.listJobs()) {
      this.scheduleJob(mindId, job, scheduler);
    }
  }

  // Note: releaseMind stops schedulers and clears in-flight tracking, but does
  // not await in-progress runJob promises. For a desktop app, process exit handles
  // cleanup. If CronService is ever used server-side, add graceful drain here.
  async releaseMind(mindId: string): Promise<void> {
    this.schedulers.get(mindId)?.stopAll();
    this.schedulers.delete(mindId);
    this.ledgers.delete(mindId);
    this.stores.delete(mindId);
    this.mindPaths.delete(mindId);

    for (const key of [...this.inFlightJobs]) {
      if (key.startsWith(`${mindId}:`)) {
        this.inFlightJobs.delete(key);
      }
    }
  }

  createJob(mindId: string, mindPath: string, input: CreateCronJobInput): CronJobListEntry {
    validateSchedule(input.schedule);
    validatePayload(input.type, input.payload);
    const store = this.ensureStore(mindId, mindPath);
    const job = store.createJob(input);
    this.scheduleJob(mindId, job);
    return this.toListEntry(mindId, job);
  }

  listJobs(mindId: string, mindPath: string): CronJobListEntry[] {
    const store = this.ensureStore(mindId, mindPath);
    return store.listJobs().map((job) => this.toListEntry(mindId, job));
  }

  removeJob(mindId: string, jobId: string): { removed: boolean } {
    const store = this.requireStore(mindId);
    const removed = store.removeJob(jobId);
    this.schedulers.get(mindId)?.unschedule(jobId);
    return { removed: removed !== null };
  }

  enableJob(mindId: string, jobId: string): CronJobListEntry {
    const store = this.requireStore(mindId);
    const job = store.updateJob(jobId, (existing) => ({ ...existing, enabled: true }));
    this.scheduleJob(mindId, job);
    return this.toListEntry(mindId, job);
  }

  disableJob(mindId: string, jobId: string): CronJobListEntry {
    const store = this.requireStore(mindId);
    const job = store.updateJob(jobId, (existing) => ({ ...existing, enabled: false }));
    this.scheduleJob(mindId, job);
    return this.toListEntry(mindId, job);
  }

  async runNow(mindId: string, jobId: string): Promise<CronJobRunRecord> {
    return this.runJob(mindId, jobId, 'manual');
  }

  listRuns(mindId: string, jobId?: string): CronJobRunRecord[] {
    const store = this.requireStore(mindId);
    const mindPath = this.mindPaths.get(mindId) ?? '';
    const jobsById = new Map(store.listJobs().map((job) => [job.id, job]));
    return this.ensureLedger(mindId, mindPath).reader.listByRuntime('cron')
      .filter((record) => record.ownerMindId === mindId)
      .filter((record) => !jobId || record.sourceId === jobId)
      .filter((record) => record.payload.runtime === 'cron')
      .map((record) => this.toCronRunRecord(record, jobsById))
      .filter((record): record is CronJobRunRecord => record !== null)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  }

  async handlePowerResume(): Promise<void> {
    const now = new Date();
    for (const [mindId, store] of this.stores.entries()) {
      for (const job of store.listJobs()) {
        if (!job.enabled) continue;
        const nextRun = this.schedulers.get(mindId)?.nextRun(job.id);
        if (!nextRun || nextRun > now) continue;
        try {
          await this.runJob(mindId, job.id, 'resume');
        } catch (err) {
          log.error(`Resume catch-up failed for job ${job.id} in mind ${mindId}:`, err);
        }
      }
    }
  }

  private ensureStore(mindId: string, mindPath: string): JobStore {
    const existing = this.stores.get(mindId);
    if (existing) return existing;

    const store = new JobStore(mindPath);
    this.stores.set(mindId, store);
    this.mindPaths.set(mindId, mindPath);
    return store;
  }

  private ensureLedger(mindId: string, mindPath: string): TaskLedger {
    const existing = this.ledgers.get(mindId);
    if (existing) return existing;

    const ledger = this.options.createTaskLedger?.(mindPath)
      ?? new TaskLedger(new SQLiteLedgerStore(path.join(mindPath, '.chamber', 'runs', 'tasks.db')));
    this.ledgers.set(mindId, ledger);
    return ledger;
  }

  private requireStore(mindId: string): JobStore {
    const mindPath = this.mindPaths.get(mindId);
    if (!mindPath) {
      throw new Error(`Mind ${mindId} is not active for cron operations`);
    }
    return this.ensureStore(mindId, mindPath);
  }

  private ensureScheduler(mindId: string): Scheduler {
    const existing = this.schedulers.get(mindId);
    if (existing) return existing;

    const scheduler = new Scheduler();
    this.schedulers.set(mindId, scheduler);
    return scheduler;
  }

  private scheduleJob(mindId: string, job: CronJob, scheduler = this.ensureScheduler(mindId)): void {
    scheduler.schedule(job, async () => {
      await this.runJob(mindId, job.id, 'scheduled');
    });
  }

  private async runJob(mindId: string, jobId: string, source: RunSource): Promise<CronJobRunRecord> {
    const store = this.requireStore(mindId);
    const mindPath = this.mindPaths.get(mindId) ?? '';
    const ledger = this.ensureLedger(mindId, mindPath);
    const job = store.getJob(jobId);
    if (!job) {
      throw new Error(`Cron job ${jobId} not found`);
    }

    const runKey = `${mindId}:${jobId}`;
    const startedAt = new Date().toISOString();
    if (this.inFlightJobs.has(runKey)) {
      const skipped = store.appendRun({
        mindId,
        jobId,
        type: job.type,
        status: 'skipped',
        startedAt,
        endedAt: startedAt,
        error: 'Skipped because a previous run is still in-flight.',
        source,
      });
      store.updateJob(jobId, (existing) => ({
        ...existing,
        lastFireAttempt: startedAt,
        lastRunAt: startedAt,
        lastRunStatus: skipped.status,
      }));
      const ledgerRow = ledger.writer.createRunning({
        runtime: 'cron',
        ownerMindId: mindId,
        scopeKind: 'system',
        task: job.name,
        runKey: `cron-${job.id}-${startedAt}`,
        sourceId: job.id,
        label: source,
        payload: { runtime: 'cron', kind: job.type },
      });
      ledger.writer.finalize(ledgerRow.ledgerId, {
        status: 'cancelled',
        terminalSummary: 'skipped',
        error: skipped.error,
      });
      return skipped;
    }

    this.inFlightJobs.add(runKey);
    store.updateJob(jobId, (existing) => ({
      ...existing,
      lastFireAttempt: startedAt,
    }));

    try {
      const result = await safelyRecordRun(
        ledger.writer,
        {
          runtime: 'cron',
          ownerMindId: mindId,
          scopeKind: 'system',
          task: job.name,
          runKey: `cron-${job.id}-${startedAt}`,
          sourceId: job.id,
          label: source,
          payload: { runtime: 'cron', kind: job.type },
        },
        async () => this.runner.run(mindId, mindPath, job),
        {},
        (result) => ({
          status: this.toLedgerStatus(result.status),
          terminalSummary: result.status,
          progressSummary: result.output,
          error: result.error,
        }),
      );
      const endedAt = new Date().toISOString();
      const record = store.appendRun({
        mindId,
        jobId,
        type: job.type,
        status: result.status,
        startedAt,
        endedAt,
        taskId: result.taskId,
        output: result.output,
        error: result.error,
        source,
      });

      store.updateJob(jobId, (existing) => ({
        ...existing,
        lastRunAt: endedAt,
        lastRunStatus: result.status,
        lastTaskId: result.taskId,
      }));
      return record;
    } finally {
      this.inFlightJobs.delete(runKey);
    }
  }

  private toListEntry(mindId: string, job: CronJob): CronJobListEntry {
    const nextRun = this.schedulers.get(mindId)?.nextRun(job.id) ?? this.buildNextRun(job);
    const latestRun = this.listRuns(mindId, job.id)[0];
    return {
      ...job,
      lastRunAt: latestRun?.endedAt ?? job.lastRunAt,
      lastRunStatus: latestRun?.status ?? job.lastRunStatus,
      lastTaskId: latestRun?.taskId ?? job.lastTaskId,
      nextRun: nextRun?.toISOString() ?? null,
    };
  }

  private toCronRunRecord(
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
      status: this.toCronRunStatus(record.status, record.terminalSummary),
      startedAt: record.startedAt ?? record.createdAt,
      endedAt: record.endedAt ?? record.lastEventAt ?? record.startedAt ?? record.createdAt,
      output: record.progressSummary,
      error: record.error,
      source: this.toRunSource(record.label),
    };
  }

  private importLegacyRuns(
    mindId: string,
    mindPath: string,
    store: JobStore,
    ledger: TaskLedger,
  ): void {
    const runsPath = this.getLegacyRunsPath(mindPath);
    if (!pathExists(runsPath)) return;

    try {
      for (const run of store.listRuns()) {
        try {
          if (ledger.reader.getByRunKey('cron', this.legacyRunKey(run))) continue;
          const ledgerRow = ledger.writer.createRunning({
            runtime: 'cron',
            ownerMindId: mindId,
            scopeKind: 'system',
            task: `Cron job ${run.jobId}`,
            runKey: this.legacyRunKey(run),
            sourceId: run.jobId,
            label: run.source,
            payload: { runtime: 'cron', kind: run.type },
          });
          ledger.writer.finalize(ledgerRow.ledgerId, {
            status: this.toLedgerStatus(run.status),
            terminalSummary: run.status,
            progressSummary: run.output,
            error: run.error,
          });
        } catch (err) {
          if (err instanceof LedgerDataError) continue;
          log.warn(`Failed to import cron run ${run.id} for mind ${mindId}:`, err);
        }
      }
      fsRenameMigrated(runsPath);
    } catch (err) {
      log.warn(`Failed to import legacy cron runs for mind ${mindId}:`, err);
    }
  }

  private legacyRunKey(run: CronJobRunRecord): string {
    return `cron-${run.jobId}-${Date.parse(run.startedAt)}`;
  }

  private getLegacyRunsPath(mindPath: string): string {
    return path.join(mindPath, '.chamber', 'cron-runs.json');
  }

  private toRunSource(label: string | undefined): RunSource {
    return label === 'manual' || label === 'resume' || label === 'scheduled' ? label : 'scheduled';
  }

  private toLedgerStatus(status: CronRunStatus): 'succeeded' | 'failed' | 'timed-out' | 'cancelled' {
    switch (status) {
      case 'completed':
        return 'succeeded';
      case 'failed':
        return 'failed';
      case 'timed-out':
        return 'timed-out';
      case 'skipped':
        return 'cancelled';
      default: {
        const _exhaustive: never = status;
        throw new Error(`Unknown cron run status: ${String(_exhaustive)}`);
      }
    }
  }

  private toCronRunStatus(status: LedgerStatus, terminalSummary?: string): CronRunStatus {
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
      default: {
        const _exhaustive: never = status;
        throw new Error(`Unknown ledger status: ${String(_exhaustive)}`);
      }
    }
  }

  private buildNextRun(job: CronJob): Date | null {
    try {
      const probe = new Cron(job.schedule, { paused: true });
      try {
        return probe.nextRun();
      } finally {
        probe.stop();
      }
    } catch {
      return null;
    }
  }
}
