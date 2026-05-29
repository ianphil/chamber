import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  CreateCronJobInput,
  CronJob,
  StoredCronJobs,
} from './types';
import { STORED_CRON_SCHEMA_VERSION } from './types';
import { runMigrations } from './migrations';

const CRON_DIR = '.chamber';
const SCHEDULES_DIR = 'schedules';
const JOBS_FILE = 'cron.json';

export class JobStore {
  private jobsCache: StoredCronJobs | null = null;
  private migrationAttempted = false;

  constructor(private readonly mindPath: string) {
    this.relocateScheduleFile();
  }

  listJobs(): CronJob[] {
    return this.readJobs().jobs;
  }

  getJob(jobId: string): CronJob | undefined {
    return this.listJobs().find((job) => job.id === jobId);
  }

  createJob(input: CreateCronJobInput): CronJob {
    const now = new Date().toISOString();
    const job: CronJob = {
      id: `cron-${randomUUID()}`,
      name: input.name,
      schedule: input.schedule,
      scriptPath: input.scriptPath,
      enabled: input.enabled ?? true,
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
      createdAt: now,
      updatedAt: now,
    };
    const state = this.readJobs();
    state.jobs.push(job);
    this.writeJobs(state);
    return job;
  }

  updateJob(jobId: string, updater: (job: CronJob) => CronJob): CronJob {
    const state = this.readJobs();
    const index = state.jobs.findIndex((job) => job.id === jobId);
    if (index === -1) throw new Error(`Cron job ${jobId} not found`);
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
    return removed;
  }

  private getCronDir(): string {
    const dir = path.join(this.mindPath, CRON_DIR);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  private getSchedulesDir(): string {
    const dir = path.join(this.getCronDir(), SCHEDULES_DIR);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  private getJobsPath(): string {
    const legacy = path.join(this.getCronDir(), JOBS_FILE);
    if (fs.existsSync(legacy)) return legacy;
    return path.join(this.getSchedulesDir(), JOBS_FILE);
  }

  private relocateScheduleFile(): void {
    const legacy = path.join(this.getCronDir(), JOBS_FILE);
    const relocated = path.join(this.getSchedulesDir(), JOBS_FILE);
    if (!fs.existsSync(legacy) || fs.existsSync(relocated)) return;
    try {
      fs.renameSync(legacy, relocated);
    } catch {
      // best-effort
    }
  }

  private readJobs(): StoredCronJobs {
    if (this.jobsCache) return this.jobsCache;
    const filePath = this.getJobsPath();
    const raw = fs.existsSync(filePath)
      ? (JSON.parse(fs.readFileSync(filePath, 'utf8')) as StoredCronJobs)
      : { jobs: [] };
    if (raw.schemaVersion !== STORED_CRON_SCHEMA_VERSION && !this.migrationAttempted) {
      this.migrationAttempted = true;
      runMigrations(this.mindPath);
      const reread = fs.existsSync(filePath)
        ? (JSON.parse(fs.readFileSync(filePath, 'utf8')) as StoredCronJobs)
        : { jobs: [], schemaVersion: STORED_CRON_SCHEMA_VERSION };
      this.jobsCache = ensureVersion(reread);
      return this.jobsCache;
    }
    this.jobsCache = ensureVersion(raw);
    return this.jobsCache;
  }

  private writeJobs(state: StoredCronJobs): void {
    state.schemaVersion = STORED_CRON_SCHEMA_VERSION;
    this.jobsCache = state;
    const filePath = this.getJobsPath();
    const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(state, null, 2) + '\n');
    fs.renameSync(temp, filePath);
  }
}

function ensureVersion(state: StoredCronJobs): StoredCronJobs {
  if (state.schemaVersion === STORED_CRON_SCHEMA_VERSION) return state;
  return { ...state, schemaVersion: STORED_CRON_SCHEMA_VERSION };
}
