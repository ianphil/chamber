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
      description:
        'Create a scheduled cron job for this mind. Always include a payload object. Payload examples: prompt { "prompt": "Summarize today", "recipient": "optional-mind-id" }; shell { "command": "node", "args": ["script.js"] }; webhook { "url": "https://example.com/hook", "body": {} }; notification { "title": "Reminder", "body": "Standup starts now." }.',
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
          payload: {
            type: 'object',
            properties: {
              prompt: { type: 'string', description: 'Prompt job text.' },
              recipient: { type: 'string', description: 'Optional target mind id for prompt jobs.' },
              command: { type: 'string', description: 'Shell job executable.' },
              args: { type: 'array', items: { type: 'string' }, description: 'Optional shell job arguments.' },
              url: { type: 'string', description: 'Webhook job URL.' },
              headers: { type: 'object', description: 'Optional webhook headers.' },
              title: { type: 'string', description: 'Notification title.' },
              body: { description: 'Notification body string or webhook JSON body.' },
            },
            description:
              'Required type-specific payload. For prompt use { "prompt": string, "recipient"?: string }; shell use { "command": string, "args"?: string[] }; webhook use { "url": string, "body"?: unknown, "headers"?: object }; notification use { "title": string, "body": string }.',
          },
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
