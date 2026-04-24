import type { SessionTool } from '../a2a/tools';
import type { CronService } from './CronService';
import type { CreateCronJobInput } from './types';

export function buildCronTools(
  mindId: string,
  mindPath: string,
  cronService: CronService,
): SessionTool[] {
  return [
    {
      name: 'cron_create',
      description: 'Create a scheduled cron job for this mind. Prompt jobs can optionally target another agent by recipient.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Human-readable job name.' },
          schedule: { type: 'string', description: 'Cron expression to schedule.' },
          type: {
            type: 'string',
            enum: ['prompt', 'shell', 'webhook', 'notification'],
            description: 'The job type to run.',
          },
          payload: { type: 'object', description: 'Type-specific job payload.' },
          enabled: { type: 'boolean', description: 'Whether the job starts enabled. Defaults to true.' },
          timeoutMs: { type: 'number', description: 'Optional timeout for prompt, shell, or webhook jobs.' },
        },
        required: ['name', 'schedule', 'type', 'payload'],
      },
      handler: async (args) => cronService.createJob(mindId, mindPath, args as unknown as CreateCronJobInput),
    },
    {
      name: 'cron_list',
      description: 'List cron jobs for this mind, including next scheduled fire time and last run details.',
      parameters: { type: 'object', properties: {} },
      handler: async () => cronService.listJobs(mindId, mindPath),
    },
    {
      name: 'cron_remove',
      description: 'Delete a cron job and its stored run history.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Cron job id.' },
        },
        required: ['id'],
      },
      handler: async (args) => cronService.removeJob(mindId, args.id as string),
    },
    {
      name: 'cron_enable',
      description: 'Enable a cron job so future schedule fires resume.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Cron job id.' },
        },
        required: ['id'],
      },
      handler: async (args) => cronService.enableJob(mindId, args.id as string),
    },
    {
      name: 'cron_disable',
      description: 'Disable a cron job without deleting it.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Cron job id.' },
        },
        required: ['id'],
      },
      handler: async (args) => cronService.disableJob(mindId, args.id as string),
    },
    {
      name: 'cron_run_now',
      description: 'Fire a cron job immediately and record the run result.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Cron job id.' },
        },
        required: ['id'],
      },
      handler: async (args) => cronService.runNow(mindId, args.id as string),
    },
    {
      name: 'cron_history',
      description: 'Show recent cron run history for this mind, optionally filtered to one job.',
      parameters: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'Optional cron job id.' },
        },
      },
      handler: async (args) => cronService.listRuns(mindId, args.jobId as string | undefined),
    },
  ];
}
