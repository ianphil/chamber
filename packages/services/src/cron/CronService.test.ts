import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Task, TaskStatusUpdateEvent } from '../a2a/types';
import type { TaskManager } from '../a2a/TaskManager';
import { InMemoryLedgerStore, TaskLedger } from '../ledger';
import { CronService } from './CronService';

const tempDirs: string[] = [];

function makeMindPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-cron-service-'));
  tempDirs.push(dir);
  return dir;
}

class MockTaskManager extends EventEmitter {
  private currentTask: Task | null = null;

  sendTask = vi.fn(async () => {
    this.currentTask = {
      id: 'task-1',
      contextId: 'ctx-1',
      status: { state: 'TASK_STATE_SUBMITTED', timestamp: new Date().toISOString() },
      artifacts: [],
      history: [],
    };

    setTimeout(() => {
      this.currentTask = {
        id: 'task-1',
        contextId: 'ctx-1',
        status: { state: 'TASK_STATE_COMPLETED', timestamp: new Date().toISOString() },
        artifacts: [
          {
            artifactId: 'artifact-1',
            name: 'response',
            parts: [{ text: 'done', mediaType: 'text/plain' }],
          },
        ],
        history: [],
      };

      const event: TaskStatusUpdateEvent & { targetMindId: string } = {
        taskId: 'task-1',
        contextId: 'ctx-1',
        status: this.currentTask?.status ?? { state: 'TASK_STATE_COMPLETED', timestamp: new Date().toISOString() },
        targetMindId: 'mind-1',
      };
      this.emit('task:status-update', event);
    }, 0);

    return this.currentTask;
  });

  getTask = vi.fn((taskId: string) => {
    if (this.currentTask?.id === taskId) {
      return this.currentTask;
    }
    return null;
  });

  cancelTask = vi.fn();
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('CronService', () => {
  const notifier = { notify: vi.fn() };

  it('runs prompt jobs through TaskManager and persists run history', async () => {
    const taskManager = new MockTaskManager();
    const showMind = vi.fn();
    const mindPath = makeMindPath();
    const service = new CronService({
      getTaskManager: () => taskManager as unknown as TaskManager,
      showMind,
      notifier,
      createTaskLedger: () => new TaskLedger(new InMemoryLedgerStore()),
    });

    await service.activateMind('mind-1', mindPath);
    const job = service.createJob('mind-1', mindPath, {
      name: 'Daily summary',
      schedule: '0 9 * * *',
      type: 'prompt',
      payload: { prompt: 'Summarize today' },
    });

    const run = await service.runNow('mind-1', job.id);
    const runs = service.listRuns('mind-1', job.id);
    const jobs = service.listJobs('mind-1', mindPath);

    expect(taskManager.sendTask).toHaveBeenCalled();
    expect(run.status).toBe('completed');
    expect(run.taskId).toBe('task-1');
    expect(runs).toHaveLength(1);
    expect(runs[0].output).toBe('done');
    expect(jobs[0].lastTaskId).toBe('task-1');
  });

  it('parallel-writes completed cron runs to the task ledger while preserving JSON history', async () => {
    const taskManager = new MockTaskManager();
    const mindPath = makeMindPath();
    const ledger = new TaskLedger(new InMemoryLedgerStore(), {
      createLedgerId: () => 'ledger-1',
      now: () => '2026-05-21T21:30:00.000Z',
    });
    const service = new CronService({
      getTaskManager: () => taskManager as unknown as TaskManager,
      showMind: vi.fn(),
      notifier,
      createTaskLedger: () => ledger,
    });

    await service.activateMind('mind-1', mindPath);
    const job = service.createJob('mind-1', mindPath, {
      name: 'Daily summary',
      schedule: '0 9 * * *',
      type: 'prompt',
      payload: { prompt: 'Summarize today' },
    });

    const run = await service.runNow('mind-1', job.id);

    expect(run.status).toBe('completed');
    expect(service.listRuns('mind-1', job.id)).toHaveLength(1);
    expect(ledger.reader.getByLedgerId('ledger-1')).toMatchObject({
      runtime: 'cron',
      ownerMindId: 'mind-1',
      sourceId: job.id,
      status: 'succeeded',
      payload: { runtime: 'cron', kind: 'prompt' },
      terminalSummary: 'completed',
    });
  });

  it('parallel-writes failed cron runs to the task ledger without changing JSON history', async () => {
    const taskManager = new MockTaskManager();
    const mindPath = makeMindPath();
    const ledger = new TaskLedger(new InMemoryLedgerStore(), {
      createLedgerId: () => 'ledger-1',
      now: () => '2026-05-21T21:30:00.000Z',
    });
    const service = new CronService({
      getTaskManager: () => taskManager as unknown as TaskManager,
      showMind: vi.fn(),
      notifier,
      createTaskLedger: () => ledger,
    });

    await service.activateMind('mind-1', mindPath);
    const job = service.createJob('mind-1', mindPath, {
      name: 'Failing shell',
      schedule: '0 9 * * *',
      type: 'shell',
      payload: { command: process.execPath, args: ['-e', 'process.exit(2)'] },
    });

    const run = await service.runNow('mind-1', job.id);

    expect(run.status).toBe('failed');
    expect(service.listRuns('mind-1', job.id)[0].status).toBe('failed');
    expect(ledger.reader.getByLedgerId('ledger-1')).toMatchObject({
      runtime: 'cron',
      ownerMindId: 'mind-1',
      status: 'failed',
      terminalSummary: 'failed',
      payload: { runtime: 'cron', kind: 'shell' },
    });
  });

  it('reads cron history from ledger rows instead of cron-runs.json', async () => {
    const taskManager = new MockTaskManager();
    const mindPath = makeMindPath();
    const ledger = new TaskLedger(new InMemoryLedgerStore(), {
      createLedgerId: () => 'ledger-direct',
      now: () => '2026-05-21T21:30:00.000Z',
    });
    const service = new CronService({
      getTaskManager: () => taskManager as unknown as TaskManager,
      showMind: vi.fn(),
      notifier,
      createTaskLedger: () => ledger,
    });

    await service.activateMind('mind-1', mindPath);
    const job = service.createJob('mind-1', mindPath, {
      name: 'Ledger only',
      schedule: '0 9 * * *',
      type: 'notification',
      payload: { title: 'Ready', body: 'Done' },
    });
    const row = ledger.writer.createRunning({
      runtime: 'cron',
      ownerMindId: 'mind-1',
      scopeKind: 'system',
      task: job.name,
      runKey: 'cron-direct',
      sourceId: job.id,
      label: 'manual',
      payload: { runtime: 'cron', kind: 'notification' },
    });
    ledger.writer.finalize(row.ledgerId, {
      status: 'succeeded',
      terminalSummary: 'completed',
      progressSummary: 'sent',
    });

    expect(service.listRuns('mind-1', job.id)).toEqual([
      expect.objectContaining({
        id: 'ledger-direct',
        jobId: job.id,
        mindId: 'mind-1',
        type: 'notification',
        status: 'completed',
        output: 'sent',
        source: 'manual',
      }),
    ]);
  });

  it('imports legacy cron-runs.json into the ledger and renames the legacy file', async () => {
    const taskManager = new MockTaskManager();
    const mindPath = makeMindPath();
    const chamberDir = path.join(mindPath, '.chamber');
    const schedulesDir = path.join(chamberDir, 'schedules');
    fs.mkdirSync(schedulesDir, { recursive: true });
    fs.writeFileSync(path.join(schedulesDir, 'cron.json'), JSON.stringify({
      jobs: [{
        id: 'cron-legacy',
        name: 'Legacy',
        schedule: '* * * * *',
        type: 'shell',
        payload: { command: process.execPath, args: ['--version'] },
        enabled: true,
        createdAt: '2026-05-21T00:00:00.000Z',
        updatedAt: '2026-05-21T00:00:00.000Z',
      }],
    }));
    fs.writeFileSync(path.join(chamberDir, 'cron-runs.json'), JSON.stringify({
      runs: {
        'cron-legacy': [{
          id: 'cron-run-legacy',
          mindId: 'mind-1',
          jobId: 'cron-legacy',
          type: 'shell',
          status: 'failed',
          startedAt: '2026-05-21T12:00:00.000Z',
          endedAt: '2026-05-21T12:00:01.000Z',
          error: 'exit 1',
          source: 'resume',
        }],
      },
    }));
    const ledger = new TaskLedger(new InMemoryLedgerStore(), {
      createLedgerId: () => 'ledger-imported',
      now: () => '2026-05-21T21:30:00.000Z',
    });
    const service = new CronService({
      getTaskManager: () => taskManager as unknown as TaskManager,
      showMind: vi.fn(),
      notifier,
      createTaskLedger: () => ledger,
    });

    await service.activateMind('mind-1', mindPath);

    expect(service.listRuns('mind-1', 'cron-legacy')).toEqual([
      expect.objectContaining({
        id: 'ledger-imported',
        jobId: 'cron-legacy',
        status: 'failed',
        error: 'exit 1',
        source: 'resume',
      }),
    ]);
    expect(fs.existsSync(path.join(chamberDir, 'cron-runs.json'))).toBe(false);
    expect(fs.readdirSync(chamberDir).some((name) => name.startsWith('cron-runs.json.migrated-'))).toBe(true);
  });

  it('rejects notification jobs missing required title or body', () => {
    const taskManager = new MockTaskManager();
    const mindPath = makeMindPath();
    const service = new CronService({
      getTaskManager: () => taskManager as unknown as TaskManager,
      showMind: vi.fn(),
      notifier,
    });

    expect(() =>
      service.createJob('mind-1', mindPath, {
        name: 'Bad notification',
        schedule: '0 9 * * *',
        type: 'notification',
        payload: { message: 'hello' } as unknown as { title: string; body: string },
      }),
    ).toThrow('notification job payload requires a non-empty "title" string');
  });

  it('rejects jobs missing payload with a specific cron_create error', () => {
    const taskManager = new MockTaskManager();
    const mindPath = makeMindPath();
    const service = new CronService({
      getTaskManager: () => taskManager as unknown as TaskManager,
      showMind: vi.fn(),
      notifier,
    });

    expect(() =>
      service.createJob('mind-1', mindPath, {
        name: 'Bad notification',
        schedule: '0 9 * * *',
        type: 'notification',
      } as unknown as Parameters<CronService['createJob']>[2]),
    ).toThrow('cron_create requires payload for notification jobs');
  });

  it('rejects prompt jobs missing required prompt field', () => {
    const taskManager = new MockTaskManager();
    const mindPath = makeMindPath();
    const service = new CronService({
      getTaskManager: () => taskManager as unknown as TaskManager,
      showMind: vi.fn(),
      notifier,
    });

    expect(() =>
      service.createJob('mind-1', mindPath, {
        name: 'Bad prompt',
        schedule: '0 9 * * *',
        type: 'prompt',
        payload: {} as unknown as { prompt: string },
      }),
    ).toThrow('prompt job payload requires a non-empty "prompt" string');
  });
});
