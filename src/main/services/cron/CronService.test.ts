import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Task, TaskStatusUpdateEvent } from '../a2a/types';
import type { TaskManager } from '../a2a/TaskManager';
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
      status: { state: 'submitted', timestamp: new Date().toISOString() },
      artifacts: [],
      history: [],
    };

    setTimeout(() => {
      this.currentTask = {
        id: 'task-1',
        contextId: 'ctx-1',
        status: { state: 'completed', timestamp: new Date().toISOString() },
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
        status: this.currentTask.status,
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
  it('runs prompt jobs through TaskManager and persists run history', async () => {
    const taskManager = new MockTaskManager();
    const showMind = vi.fn();
    const mindPath = makeMindPath();
    const service = new CronService({
      getTaskManager: () => taskManager as unknown as TaskManager,
      showMind,
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

  it('rejects notification jobs missing required title or body', () => {
    const taskManager = new MockTaskManager();
    const mindPath = makeMindPath();
    const service = new CronService({
      getTaskManager: () => taskManager as unknown as TaskManager,
      showMind: vi.fn(),
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

  it('rejects prompt jobs missing required prompt field', () => {
    const taskManager = new MockTaskManager();
    const mindPath = makeMindPath();
    const service = new CronService({
      getTaskManager: () => taskManager as unknown as TaskManager,
      showMind: vi.fn(),
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
