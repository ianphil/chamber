import { execFile } from 'child_process';
import { Notification } from 'electron';
import { promisify } from 'util';
import type { UserInputHandler } from '../mind/types';
import { createTextMessage } from '../a2a/helpers';
import type { TaskManager } from '../a2a/TaskManager';
import type { Task, TaskState, TaskStatusUpdateEvent } from '../a2a/types';
import type { CronJob, CronJobRunRecord, CronRunStatus } from './types';

const execFileAsync = promisify(execFile);
const DEFAULT_PROMPT_TIMEOUT_MS = 120_000;
const DEFAULT_PROCESS_TIMEOUT_MS = 60_000;
const DEFAULT_WEBHOOK_TIMEOUT_MS = 10_000;

// Intentionally includes 'auth-required' and 'input-required' unlike
// TaskManager.TERMINAL_STATES — cron jobs are unattended and cannot
// provide credentials or answer input requests, so these are terminal.
const CRON_TERMINAL_STATES: ReadonlySet<TaskState> = new Set([
  'completed', 'failed', 'canceled', 'rejected', 'auth-required', 'input-required',
]);

export interface PromptJobResult {
  status: CronRunStatus;
  taskId: string;
  output?: string;
  error?: string;
}

interface JobRunnerOptions {
  getTaskManager: () => TaskManager;
  showMind: (mindId: string) => void;
}

export class JobRunner {
  constructor(private readonly options: JobRunnerOptions) {}

  async run(
    mindId: string,
    mindPath: string,
    job: CronJob,
  ): Promise<Omit<CronJobRunRecord, 'id' | 'mindId' | 'jobId' | 'type' | 'startedAt' | 'endedAt' | 'source'>> {
    switch (job.type) {
      case 'prompt':
        return this.runPromptJob(mindId, job);
      case 'shell':
        return this.runShellJob(mindPath, job);
      case 'webhook':
        return this.runWebhookJob(job);
      case 'notification':
        return this.runNotificationJob(mindId, job);
    }
  }

  private async runPromptJob(mindId: string, job: Extract<CronJob, { type: 'prompt' }>): Promise<PromptJobResult> {
    const taskManager = this.options.getTaskManager();
    const onUserInputRequest: UserInputHandler = async (request) => {
      throw new Error(`Cron prompt jobs cannot answer user input requests: ${request.question}`);
    };

    const task = await taskManager.sendTask({
      recipient: job.payload.recipient ?? mindId,
      message: createTextMessage(mindId, job.payload.prompt),
      onUserInputRequest,
    });

    return this.waitForTask(taskManager, task.id, job.timeoutMs ?? DEFAULT_PROMPT_TIMEOUT_MS);
  }

  private async runShellJob(
    mindPath: string,
    job: Extract<CronJob, { type: 'shell' }>,
  ): Promise<{ status: CronRunStatus; output?: string; error?: string }> {
    const timeoutMs = job.timeoutMs ?? DEFAULT_PROCESS_TIMEOUT_MS;
    try {
      const result = await execFileAsync(job.payload.command, job.payload.args ?? [], {
        cwd: mindPath,
        timeout: timeoutMs,
        windowsHide: true,
      });
      return {
        status: 'completed',
        output: [result.stdout, result.stderr].filter(Boolean).join('\n').trim(),
      };
    } catch (err) {
      const error = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; killed?: boolean };
      return {
        status: error.killed ? 'timed-out' : 'failed',
        output: [error.stdout, error.stderr].filter(Boolean).join('\n').trim(),
        error: error.message,
      };
    }
  }

  private async runWebhookJob(
    job: Extract<CronJob, { type: 'webhook' }>,
  ): Promise<{ status: CronRunStatus; output?: string; error?: string }> {
    const timeoutMs = job.timeoutMs ?? DEFAULT_WEBHOOK_TIMEOUT_MS;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(job.payload.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...job.payload.headers,
        },
        body: job.payload.body === undefined ? undefined : JSON.stringify(job.payload.body),
        signal: controller.signal,
      });
      const body = await response.text();
      return response.ok
        ? { status: 'completed', output: body }
        : { status: 'failed', output: body, error: `Webhook returned ${response.status}` };
    } catch (err) {
      const error = err as Error;
      return {
        status: error.name === 'AbortError' ? 'timed-out' : 'failed',
        error: error.message,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async runNotificationJob(
    mindId: string,
    job: Extract<CronJob, { type: 'notification' }>,
  ): Promise<{ status: CronRunStatus; output?: string }> {
    const notification = new Notification({
      title: job.payload.title,
      body: job.payload.body,
    });
    notification.on('click', () => this.options.showMind(mindId));
    notification.show();
    return { status: 'completed', output: 'Notification shown.' };
  }

  private async waitForTask(
    taskManager: TaskManager,
    taskId: string,
    timeoutMs: number,
  ): Promise<PromptJobResult> {
    const existing = taskManager.getTask(taskId);
    if (existing && this.isTerminal(existing.status.state)) {
      return this.summarizeTask(existing);
    }

    return new Promise((resolve) => {
      const cleanup = (handler: (event: TaskStatusUpdateEvent & { targetMindId: string }) => void, timer: NodeJS.Timeout) => {
        clearTimeout(timer);
        taskManager.off('task:status-update', handler);
      };

      const onStatusUpdate = (event: TaskStatusUpdateEvent & { targetMindId: string }) => {
        if (event.taskId !== taskId || !this.isTerminal(event.status.state)) {
          return;
        }

        cleanup(onStatusUpdate, timer);
        const task = taskManager.getTask(taskId);
        resolve(this.summarizeTask(task ?? null, taskId));
      };

      const timer = setTimeout(() => {
        cleanup(onStatusUpdate, timer);
        try {
          taskManager.cancelTask(taskId);
        } catch {
          // ignore cancel errors — task may have completed just before timeout
        }
        resolve({
          status: 'timed-out',
          taskId,
          error: `Timed out after ${timeoutMs}ms`,
        });
      }, timeoutMs);

      taskManager.on('task:status-update', onStatusUpdate);
    });
  }

  private summarizeTask(task: Task | null, fallbackTaskId?: string): PromptJobResult {
    if (!task) {
      return {
        status: 'failed',
        taskId: fallbackTaskId ?? 'unknown-task',
        error: 'Task not found after completion.',
      };
    }

    const output = (task.artifacts ?? [])
      .flatMap((artifact) => artifact.parts ?? [])
      .map((part) => part.text ?? '')
      .filter(Boolean)
      .join('\n\n')
      .trim();

    switch (task.status.state) {
      case 'completed':
        return { status: 'completed', taskId: task.id, output };
      case 'canceled':
        return { status: 'timed-out', taskId: task.id, output, error: 'Task was canceled.' };
      case 'failed':
      case 'rejected':
      case 'auth-required':
      case 'input-required':
        return {
          status: 'failed',
          taskId: task.id,
          output,
          error: task.status.message?.parts?.find((part) => part.text)?.text ?? `Task ended in state ${task.status.state}.`,
        };
      default:
        return {
          status: 'failed',
          taskId: task.id,
          output,
          error: `Unexpected terminal state: ${task.status.state}`,
        };
    }
  }

  private isTerminal(state: TaskState): boolean {
    return CRON_TERMINAL_STATES.has(state);
  }
}
