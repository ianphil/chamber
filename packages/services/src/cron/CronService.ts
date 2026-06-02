import { Cron } from 'croner';
import { getErrorMessage } from '@chamber/shared/getErrorMessage';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SqliteStore } from '@ianphil/ttasks-ts';
import type { ChamberToolProvider } from '../chamberTools';
import type { Tool } from '../mind/types';
import { Logger } from '../logger';
import { JobStore } from './JobStore';
import { ScriptRunner } from './ScriptRunner';
import { TTasksCronRunStore, type CronRunStore } from './CronRunStore';
import { Scheduler, validateSchedule } from './Scheduler';
import { buildCronTools } from './tools';
import { validateScriptPath } from './validateScriptPath';
import type {
  CreateCronJobInput,
  CronJob,
  CronJobListEntry,
  CronJobRunRecord,
  CronRunDetail,
  RunSource,
} from './types';

const log = Logger.create('cron');

export interface CronServiceOptions {
  scriptRunner: ScriptRunner;
  createCronRunStore?: (mindPath: string) => CronRunStore;
}

/**
 * v2 cron service. Each cron job points at a TypeScript automation script
 * under the mind's `.chamber/automation/` directory. Scheduled fires spawn
 * the script via `ScriptRunner`; run history is persisted in
 * `.chamber/runs/ttasks.db`.
 */
export class CronService implements ChamberToolProvider {
  private readonly stores = new Map<string, JobStore>();
  private readonly schedulers = new Map<string, Scheduler>();
  private readonly runStores = new Map<string, CronRunStore>();
  private readonly mindPaths = new Map<string, string>();
  private readonly inFlightJobs = new Set<string>();

  constructor(private readonly options: CronServiceOptions) {}

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

  async releaseMind(mindId: string): Promise<void> {
    this.schedulers.get(mindId)?.stopAll();
    this.schedulers.delete(mindId);
    this.runStores.delete(mindId);
    this.stores.delete(mindId);
    this.mindPaths.delete(mindId);
    for (const key of [...this.inFlightJobs]) {
      if (key.startsWith(`${mindId}:`)) this.inFlightJobs.delete(key);
    }
  }

  createJob(mindId: string, mindPath: string, input: CreateCronJobInput): CronJobListEntry {
    validateSchedule(input.schedule);
    validateScriptPath(mindPath, input.scriptPath);
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
    this.schedulers.get(mindId)?.unschedule(jobId);
    if (job.enabled) this.scheduleJob(mindId, job);
    return this.toListEntry(mindId, job);
  }

  async runNow(mindId: string, jobId: string): Promise<CronJobRunRecord> {
    return this.runJob(mindId, jobId, 'manual');
  }

  /**
   * Run an arbitrary script under this mind without persisting it as a cron
   * job. Backs the `automation_run` tool.
   */
  async runScript(mindId: string, scriptPath: string): Promise<CronJobRunRecord> {
    const mindPath = this.requireMindPath(mindId);
    const runStore = this.ensureRunStore(mindId, mindPath);
    const startedAt = new Date().toISOString();
    const result = await this.options.scriptRunner.run({
      mindId,
      mindPath,
      scriptPath,
    });
    const endedAt = new Date().toISOString();
    return runStore.recordRun({
      mindId,
      jobId: '__ad_hoc__',
      status: result.status,
      startedAt,
      endedAt,
      ...(result.graphId ? { graphId: result.graphId } : {}),
      ...(result.output ? { output: result.output } : {}),
      ...(result.error ? { error: result.error } : {}),
      source: 'manual',
    });
  }

  listRuns(mindId: string, jobId?: string): CronJobRunRecord[] {
    const mindPath = this.requireMindPath(mindId);
    return this.ensureRunStore(mindId, mindPath).listRuns(mindId, jobId);
  }

  getRunDetail(mindId: string, runId: string): CronRunDetail | null {
    const mindPath = this.requireMindPath(mindId);
    const detail = this.ensureRunStore(mindId, mindPath).getRunDetail(runId);
    if (!detail) return null;
    if (detail.run.mindId !== mindId) return null;
    return detail;
  }

  async validateScript(mindId: string, scriptPath: string): Promise<{ ok: boolean; output: string }> {
    const mindPath = this.requireMindPath(mindId);
    return this.options.scriptRunner.validateScript({ mindPath, scriptPath });
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

  private async runJob(mindId: string, jobId: string, source: RunSource): Promise<CronJobRunRecord> {
    const store = this.requireStore(mindId);
    const mindPath = this.requireMindPath(mindId);
    const runStore = this.ensureRunStore(mindId, mindPath);
    const job = store.getJob(jobId);
    if (!job) throw new Error(`Cron job ${jobId} not found`);

    const runKey = `${mindId}:${jobId}`;
    const startedAt = new Date().toISOString();
    if (this.inFlightJobs.has(runKey)) {
      const skipped = runStore.recordRun({
        mindId,
        jobId,
        status: 'skipped',
        startedAt,
        endedAt: startedAt,
        error: 'Skipped because a previous run is still in-flight.',
        source,
      }, job);
      store.updateJob(jobId, (existing) => ({
        ...existing,
        lastFireAttempt: startedAt,
        lastRunAt: startedAt,
        lastRunStatus: 'skipped',
      }));
      return skipped;
    }

    this.inFlightJobs.add(runKey);
    store.updateJob(jobId, (existing) => ({ ...existing, lastFireAttempt: startedAt }));

    try {
      const result = await this.options.scriptRunner.run({
        mindId,
        mindPath,
        scriptPath: job.scriptPath,
        ...(job.timeoutMs !== undefined ? { timeoutMs: job.timeoutMs } : {}),
      });
      const endedAt = new Date().toISOString();
      const record = runStore.recordRun({
        mindId,
        jobId,
        status: result.status,
        startedAt,
        endedAt,
        graphId: result.graphId,
        ...(result.output ? { output: result.output } : {}),
        ...(result.error ? { error: result.error } : {}),
        source,
      }, job);
      store.updateJob(jobId, (existing) => ({
        ...existing,
        lastRunAt: endedAt,
        lastRunStatus: result.status,
        lastGraphId: result.graphId,
      }));
      return record;
    } catch (err) {
      const endedAt = new Date().toISOString();
      const error = getErrorMessage(err);
      try {
        runStore.recordRun({
          mindId,
          jobId,
          status: 'failed',
          startedAt,
          endedAt,
          error,
          source,
        }, job);
        store.updateJob(jobId, (existing) => ({
          ...existing,
          lastRunAt: endedAt,
          lastRunStatus: 'failed',
        }));
      } catch (recordErr) {
        log.warn(`Failed to persist failed cron run ${jobId} for mind ${mindId}:`, recordErr);
      }
      throw err;
    } finally {
      this.inFlightJobs.delete(runKey);
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

  private ensureRunStore(mindId: string, mindPath: string): CronRunStore {
    const existing = this.runStores.get(mindId);
    if (existing) return existing;
    const runStore = this.options.createCronRunStore?.(mindPath)
      ?? this.createDefaultRunStore(mindPath);
    this.runStores.set(mindId, runStore);
    return runStore;
  }

  private createDefaultRunStore(mindPath: string): CronRunStore {
    const runsDir = path.join(mindPath, '.chamber', 'runs');
    fs.mkdirSync(runsDir, { recursive: true });
    return new TTasksCronRunStore(new SqliteStore({ path: path.join(runsDir, 'ttasks.db') }));
  }

  private requireStore(mindId: string): JobStore {
    const mindPath = this.requireMindPath(mindId);
    return this.ensureStore(mindId, mindPath);
  }

  private requireMindPath(mindId: string): string {
    const mindPath = this.mindPaths.get(mindId);
    if (!mindPath) throw new Error(`Mind ${mindId} is not active for cron operations`);
    return mindPath;
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
      try { return probe.nextRun(); } finally { probe.stop(); }
    } catch {
      return null;
    }
  }
}
