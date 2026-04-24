import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type {
  CreateCronJobInput,
  CronJob,
  CronJobRunRecord,
  StoredCronJobs,
  StoredCronRuns,
} from './types';

const CRON_DIR = '.chamber';
const JOBS_FILE = 'cron.json';
const RUNS_FILE = 'cron-runs.json';
const DEFAULT_RUN_LIMIT = 50;

export class JobStore {
  private jobsCache: StoredCronJobs | null = null;
  private runsCache: StoredCronRuns | null = null;

  constructor(
    private readonly mindPath: string,
    private readonly runLimit = DEFAULT_RUN_LIMIT,
  ) {}

  listJobs(): CronJob[] {
    return this.readJobs().jobs;
  }

  getJob(jobId: string): CronJob | undefined {
    return this.listJobs().find((job) => job.id === jobId);
  }

  createJob(input: CreateCronJobInput): CronJob {
    const now = new Date().toISOString();
    // CreateCronJobInput is a discriminated union that correlates type + payload,
    // so spreading preserves the discriminant and makes the assertion safe.
    const job = {
      id: `cron-${randomUUID()}`,
      ...input,
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    } as CronJob;

    const state = this.readJobs();
    state.jobs.push(job);
    this.writeJobs(state);
    return job;
  }

  updateJob(jobId: string, updater: (job: CronJob) => CronJob): CronJob {
    const state = this.readJobs();
    const index = state.jobs.findIndex((job) => job.id === jobId);
    if (index === -1) {
      throw new Error(`Cron job ${jobId} not found`);
    }

    const updated = {
      ...updater(state.jobs[index]),
      updatedAt: new Date().toISOString(),
    };
    state.jobs[index] = updated;
    this.writeJobs(state);
    return updated;
  }

  removeJob(jobId: string): CronJob | null {
    const state = this.readJobs();
    const index = state.jobs.findIndex((job) => job.id === jobId);
    if (index === -1) return null;

    const [removed] = state.jobs.splice(index, 1);
    this.writeJobs(state);

    const runs = this.readRuns();
    delete runs.runs[jobId];
    this.writeRuns(runs);

    return removed;
  }

  listRuns(jobId?: string): CronJobRunRecord[] {
    const state = this.readRuns();
    const runs = jobId ? (state.runs[jobId] ?? []) : Object.values(state.runs).flat();
    return [...runs].sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  }

  appendRun(
    run: Omit<CronJobRunRecord, 'id'>,
  ): CronJobRunRecord {
    const state = this.readRuns();
    const existing = state.runs[run.jobId] ?? [];
    const record: CronJobRunRecord = {
      id: `cron-run-${randomUUID()}`,
      ...run,
    };

    state.runs[run.jobId] = [...existing, record].slice(-this.runLimit);
    this.writeRuns(state);
    return record;
  }

  private getCronDir(): string {
    const cronDir = path.join(this.mindPath, CRON_DIR);
    fs.mkdirSync(cronDir, { recursive: true });
    return cronDir;
  }

  private getJobsPath(): string {
    return path.join(this.getCronDir(), JOBS_FILE);
  }

  private getRunsPath(): string {
    return path.join(this.getCronDir(), RUNS_FILE);
  }

  private readJobs(): StoredCronJobs {
    if (this.jobsCache) return this.jobsCache;
    this.jobsCache = this.readJson(this.getJobsPath(), { jobs: [] });
    return this.jobsCache;
  }

  private writeJobs(state: StoredCronJobs): void {
    this.jobsCache = state;
    this.writeJson(this.getJobsPath(), state);
  }

  private readRuns(): StoredCronRuns {
    if (this.runsCache) return this.runsCache;
    this.runsCache = this.readJson(this.getRunsPath(), { runs: {} });
    return this.runsCache;
  }

  private writeRuns(state: StoredCronRuns): void {
    this.runsCache = state;
    this.writeJson(this.getRunsPath(), state);
  }

  private readJson<T>(filePath: string, fallback: T): T {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  }

  private writeJson(filePath: string, value: unknown): void {
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(value, null, 2) + '\n');
    fs.renameSync(tempPath, filePath);
  }
}
