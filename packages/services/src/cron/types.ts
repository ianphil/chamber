/**
 * Chamber cron types.
 *
 * v2 cron model: every cron job schedules a TypeScript automation script
 * authored by a mind under `.chamber/automation/`. The script defines the
 * workflow as a `@ianphil/ttasks-ts` graph. Cron's only job is to spawn the
 * script on a schedule and record what happened.
 *
 * The legacy `prompt | shell | webhook | notification` job-type model has
 * been removed. Existing v1 stores are migrated in-place; see
 * `migrations/v1-to-v2.ts`. The `schemaVersion` field on `StoredCronJobs`
 * marks the on-disk layout version, not a per-job type.
 */

export type CronRunStatus = 'completed' | 'failed' | 'timed-out' | 'skipped' | 'canceled';
export type RunSource = 'scheduled' | 'manual' | 'resume';

export interface CronJob {
  id: string;
  name: string;
  schedule: string;
  /**
   * Mind-relative path to the automation script. Always under
   * `.chamber/automation/`, always ends `.ts`. Validated by
   * `validateScriptPath` before the script is allowed to run.
   */
  scriptPath: string;
  enabled: boolean;
  /** Optional per-run timeout in milliseconds. Defaults to 10 minutes. */
  timeoutMs?: number;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastRunStatus?: CronRunStatus;
  /** Graph id of the most recent run (for joining with ttasks DB rows). */
  lastGraphId?: string;
  lastFireAttempt?: string;
  /** True if this job was produced by the v1 → v2 migration. */
  isMigrated?: boolean;
}

export interface CreateCronJobInput {
  name: string;
  schedule: string;
  scriptPath: string;
  enabled?: boolean;
  timeoutMs?: number;
}

export interface CronJobRunRecord {
  id: string;
  jobId: string;
  mindId: string;
  status: CronRunStatus;
  startedAt: string;
  endedAt: string;
  /**
   * UUID linking this cron run to ttasks-ts rows in `.chamber/runs/ttasks.db`.
   * `cron_run_detail(runId)` joins on this to produce the per-task tree.
   */
  graphId?: string;
  /** Captured stdout from the script subprocess (length-capped + redacted). */
  output?: string;
  error?: string;
  source: RunSource;
}

export type CronJobListEntry = CronJob & {
  nextRun: string | null;
};

export const STORED_CRON_SCHEMA_VERSION = 2 as const;

export interface StoredCronJobs {
  /** On-disk schema version. Absent → treat as v1 (will be migrated). */
  schemaVersion?: number;
  jobs: CronJob[];
}

export interface StoredCronRuns {
  runs: Record<string, CronJobRunRecord[]>;
}

/**
 * Sidecar surfaced to the user when one or more jobs failed to translate
 * during v1 → v2 migration. Cron is unblocked for the jobs that did
 * translate; quarantined entries land here for the user to inspect.
 */
export interface CronMigrationError {
  legacyId: string;
  legacyType: string;
  legacyName?: string;
  reason: string;
  capturedAt: string;
}

export interface StoredCronMigrationErrors {
  errors: CronMigrationError[];
}

export interface CronRunDetailNode {
  id: string;
  type: string;
  title: string;
  status: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  output?: string;
  error?: string | null;
  parentId?: string | null;
}

export interface CronRunDetail {
  run: CronJobRunRecord;
  graph: CronRunDetailNode[];
}
