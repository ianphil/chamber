import { Cron } from 'croner';
import type { ChamberToolProvider } from '../chamberTools';
import type { Tool } from '../mind/types';
import type { TaskManager } from '../a2a/TaskManager';
import { JobStore } from './JobStore';
import { JobRunner } from './JobRunner';
import { Scheduler, validateSchedule } from './Scheduler';
import { buildCronTools } from './tools';
import type { CreateCronJobInput, CronJob, CronJobListEntry, CronJobPayload, CronJobRunRecord, CronJobType, RunSource } from './types';

function requireString(payload: Record<string, unknown>, field: string, jobType: string): void {
  if (typeof payload[field] !== 'string' || (payload[field] as string).trim() === '') {
    throw new Error(`${jobType} job payload requires a non-empty "${field}" string`);
  }
}

function validatePayload(type: CronJobType, payload: CronJobPayload): void {
  const p = payload as unknown as Record<string, unknown>;
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
}

// TODO: Consider extracting execution coordination (runJob, inFlightJobs,
// handlePowerResume) into a dedicated CronExecutor to improve SRP adherence.
// See: https://github.com/ianphil/chamber/issues/TBD
export class CronService implements ChamberToolProvider {
  private readonly stores = new Map<string, JobStore>();
  private readonly schedulers = new Map<string, Scheduler>();
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
    return this.requireStore(mindId).listRuns(jobId);
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
          console.error(`[cron] Resume catch-up failed for job ${job.id} in mind ${mindId}:`, err);
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
      return skipped;
    }

    this.inFlightJobs.add(runKey);
    store.updateJob(jobId, (existing) => ({
      ...existing,
      lastFireAttempt: startedAt,
    }));

    try {
      const result = await this.runner.run(mindId, this.mindPaths.get(mindId) ?? '', job);
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
    return {
      ...job,
      nextRun: nextRun?.toISOString() ?? null,
    };
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
