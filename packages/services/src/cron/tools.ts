import type { SessionTool } from '../a2a/tools';
import type { CronService } from './CronService';
import type { CreateCronJobInput } from './types';

/**
 * v2 cron tools. Cron schedules TypeScript automation scripts authored by
 * the mind under `.chamber/automation/*.ts`. To create a new scheduled job:
 *
 *  1. Write the script using `@chamber/automation-runtime` (Task graphs).
 *  2. Validate it with `automation_validate(scriptPath)`.
 *  3. Run it once with `automation_run(scriptPath)` to verify behavior.
 *  4. Schedule it with `cron_create({name, schedule, scriptPath})`.
 */
export function buildCronTools(
  mindId: string,
  mindPath: string,
  cronService: CronService,
): SessionTool[] {
  return [
    {
      name: 'cron_create',
      description:
        'Schedule an automation script. The script must already exist under .chamber/automation/ and end .ts. Use automation_validate first.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Human-readable job name.' },
          schedule: { type: 'string', description: 'Cron expression (croner-compatible).' },
          scriptPath: {
            type: 'string',
            description: 'Mind-relative path to the TS script, e.g. ".chamber/automation/daily-summary.ts".',
          },
          enabled: { type: 'boolean', description: 'Whether the job starts enabled. Defaults to true.' },
          timeoutMs: { type: 'number', description: 'Optional per-run timeout in ms (default 600000).' },
        },
        required: ['name', 'schedule', 'scriptPath'],
      },
      handler: async (args) =>
        cronService.createJob(mindId, mindPath, args as unknown as CreateCronJobInput),
    },
    {
      name: 'cron_list',
      description: 'List scheduled automation scripts for this mind, with next-run time and last-run status.',
      parameters: { type: 'object', properties: {} },
      handler: async () => cronService.listJobs(mindId, mindPath),
    },
    {
      name: 'cron_remove',
      description: 'Delete a scheduled cron job. The script file remains on disk.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Cron job id.' } },
        required: ['id'],
      },
      handler: async (args) => cronService.removeJob(mindId, args.id as string),
    },
    {
      name: 'cron_enable',
      description: 'Enable a cron job so future schedule fires resume.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Cron job id.' } },
        required: ['id'],
      },
      handler: async (args) => cronService.enableJob(mindId, args.id as string),
    },
    {
      name: 'cron_disable',
      description: 'Disable a cron job without deleting it.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Cron job id.' } },
        required: ['id'],
      },
      handler: async (args) => cronService.disableJob(mindId, args.id as string),
    },
    {
      name: 'cron_run_now',
      description: 'Fire a cron job immediately and record the run result.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Cron job id.' } },
        required: ['id'],
      },
      handler: async (args) => cronService.runNow(mindId, args.id as string),
    },
    {
      name: 'cron_history',
      description: 'Show recent cron run history, optionally filtered to one job id.',
      parameters: {
        type: 'object',
        properties: { jobId: { type: 'string', description: 'Optional cron job id.' } },
      },
      handler: async (args) => cronService.listRuns(mindId, args.jobId as string | undefined),
    },
    {
      name: 'automation_run',
      description:
        'Execute an automation script once without scheduling. Useful for verifying scripts before cron_create.',
      parameters: {
        type: 'object',
        properties: {
          scriptPath: { type: 'string', description: 'Mind-relative path to a .ts script under .chamber/automation/.' },
        },
        required: ['scriptPath'],
      },
      handler: async (args) => cronService.runScript(mindId, args.scriptPath as string),
    },
    {
      name: 'automation_validate',
      description:
        'Type-check a .chamber/automation/*.ts script with tsc --noEmit. Always run this before cron_create.',
      parameters: {
        type: 'object',
        properties: {
          scriptPath: { type: 'string', description: 'Mind-relative path to a .ts script under .chamber/automation/.' },
        },
        required: ['scriptPath'],
      },
      handler: async (args) => cronService.validateScript(mindId, args.scriptPath as string),
    },
    {
      name: 'cron_run_detail',
      description: 'Open a single cron run and return the per-task tree the script produced.',
      parameters: {
        type: 'object',
        properties: { runId: { type: 'string', description: 'Cron run id (from cron_history).' } },
        required: ['runId'],
      },
      handler: async (args) => cronService.getRunDetail(mindId, args.runId as string),
    },
  ];
}
