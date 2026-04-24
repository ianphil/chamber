export type CronJobType = 'prompt' | 'shell' | 'webhook' | 'notification';
export type CronRunStatus = 'completed' | 'failed' | 'timed-out' | 'skipped';
export type RunSource = 'scheduled' | 'manual' | 'resume';

export interface PromptJobPayload {
  recipient?: string;
  prompt: string;
}

export interface ShellJobPayload {
  command: string;
  args?: string[];
}

export interface WebhookJobPayload {
  url: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface NotificationJobPayload {
  title: string;
  body: string;
}

interface CronJobBase<TType extends CronJobType, TPayload> {
  id: string;
  name: string;
  schedule: string;
  type: TType;
  payload: TPayload;
  enabled: boolean;
  timeoutMs?: number;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastRunStatus?: CronRunStatus;
  lastTaskId?: string;
  lastFireAttempt?: string;
}

export type PromptCronJob = CronJobBase<'prompt', PromptJobPayload>;
export type ShellCronJob = CronJobBase<'shell', ShellJobPayload>;
export type WebhookCronJob = CronJobBase<'webhook', WebhookJobPayload>;
export type NotificationCronJob = CronJobBase<'notification', NotificationJobPayload>;

export type CronJob =
  | PromptCronJob
  | ShellCronJob
  | WebhookCronJob
  | NotificationCronJob;

export type CronJobPayload =
  | PromptJobPayload
  | ShellJobPayload
  | WebhookJobPayload
  | NotificationJobPayload;

interface CreateCronJobInputBase<TType extends CronJobType, TPayload> {
  name: string;
  schedule: string;
  type: TType;
  payload: TPayload;
  enabled?: boolean;
  timeoutMs?: number;
}

export type CreateCronJobInput =
  | CreateCronJobInputBase<'prompt', PromptJobPayload>
  | CreateCronJobInputBase<'shell', ShellJobPayload>
  | CreateCronJobInputBase<'webhook', WebhookJobPayload>
  | CreateCronJobInputBase<'notification', NotificationJobPayload>;

export interface CronJobRunRecord {
  id: string;
  jobId: string;
  mindId: string;
  type: CronJobType;
  status: CronRunStatus;
  startedAt: string;
  endedAt: string;
  taskId?: string;
  output?: string;
  error?: string;
  source: RunSource;
}

export type CronJobListEntry = CronJob & {
  nextRun: string | null;
};

export interface StoredCronJobs {
  jobs: CronJob[];
}

export interface StoredCronRuns {
  runs: Record<string, CronJobRunRecord[]>;
}
