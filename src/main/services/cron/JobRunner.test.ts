import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import type { TaskManager } from '../a2a/TaskManager';
import type { Task, TaskStatusUpdateEvent } from '../a2a/types';
import type { CronJob } from './types';

// Mock electron Notification
const mockNotificationShow = vi.fn();
const mockNotificationOn = vi.fn();

vi.mock('electron', () => ({
  Notification: function MockNotification() {
    return { show: mockNotificationShow, on: mockNotificationOn };
  },
}));

// Mock child_process
const mockExecFile = vi.fn();
vi.mock('child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

import { JobRunner } from './JobRunner';

function makeJob(overrides: Partial<CronJob> & { type: CronJob['type'] }): CronJob {
  return {
    id: 'job-1',
    name: 'Test Job',
    schedule: '* * * * *',
    enabled: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as CronJob;
}

describe('JobRunner', () => {
  let runner: JobRunner;
  let mockTaskManager: EventEmitter & {
    sendTask: ReturnType<typeof vi.fn>;
    getTask: ReturnType<typeof vi.fn>;
    cancelTask: ReturnType<typeof vi.fn>;
  };
  const showMind = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockTaskManager = Object.assign(new EventEmitter(), {
      sendTask: vi.fn(),
      getTask: vi.fn(),
      cancelTask: vi.fn(),
    });

    runner = new JobRunner({
      getTaskManager: () => mockTaskManager as unknown as TaskManager,
      showMind,
    });
  });

  describe('notification jobs', () => {
    it('shows a notification and returns completed', async () => {
      const job = makeJob({
        type: 'notification',
        payload: { title: 'Hello', body: 'World' },
      });

      const result = await runner.run('mind-1', '/path', job);

      expect(mockNotificationShow).toHaveBeenCalledOnce();
      expect(result.status).toBe('completed');
      expect(result.output).toBe('Notification shown.');
    });
  });

  describe('shell jobs', () => {
    it('runs a command and returns completed on success', async () => {
      mockExecFile.mockImplementation(
        (cmd: string, args: string[], opts: unknown, cb: (err: null, result: { stdout: string; stderr: string }) => void) => {
          cb(null, { stdout: 'hello', stderr: '' });
        },
      );

      const job = makeJob({
        type: 'shell',
        payload: { command: 'echo', args: ['hello'] },
      });

      const result = await runner.run('mind-1', '/path', job);

      expect(result.status).toBe('completed');
      expect(result.output).toBe('hello');
    });

    it('returns failed when command errors', async () => {
      const error = Object.assign(new Error('not found'), {
        killed: false,
        stdout: '',
        stderr: 'command not found',
      });
      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error) => void) => {
          cb(error);
        },
      );

      const job = makeJob({
        type: 'shell',
        payload: { command: 'nonexistent' },
      });

      const result = await runner.run('mind-1', '/path', job);

      expect(result.status).toBe('failed');
      expect(result.error).toContain('not found');
    });

    it('returns timed-out when killed', async () => {
      const error = Object.assign(new Error('timed out'), {
        killed: true,
        stdout: '',
        stderr: '',
      });
      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error) => void) => {
          cb(error);
        },
      );

      const job = makeJob({
        type: 'shell',
        payload: { command: 'sleep', args: ['999'] },
        timeoutMs: 100,
      });

      const result = await runner.run('mind-1', '/path', job);

      expect(result.status).toBe('timed-out');
    });
  });

  describe('prompt jobs', () => {
    it('sends a task and returns completed when task succeeds', async () => {
      const task: Task = {
        id: 'task-1',
        contextId: 'ctx-1',
        status: { state: 'completed', timestamp: new Date().toISOString() },
        artifacts: [{ artifactId: 'a1', name: 'response', parts: [{ text: 'result', mediaType: 'text/plain' }] }],
        history: [],
      };

      mockTaskManager.sendTask.mockImplementation(async () => {
        setTimeout(() => {
          mockTaskManager.getTask.mockReturnValue(task);
          const event: TaskStatusUpdateEvent & { targetMindId: string } = {
            taskId: 'task-1',
            contextId: 'ctx-1',
            status: task.status,
            targetMindId: 'mind-1',
          };
          mockTaskManager.emit('task:status-update', event);
        }, 0);

        return { ...task, status: { state: 'submitted', timestamp: new Date().toISOString() } };
      });

      const job = makeJob({
        type: 'prompt',
        payload: { prompt: 'Do something' },
      });

      const result = await runner.run('mind-1', '/path', job);

      expect(result.status).toBe('completed');
      expect(result.taskId).toBe('task-1');
      expect(result.output).toBe('result');
    });

    it('returns failed when task is not found after completion', async () => {
      mockTaskManager.sendTask.mockImplementation(async () => {
        setTimeout(() => {
          mockTaskManager.getTask.mockReturnValue(null);
          const event: TaskStatusUpdateEvent & { targetMindId: string } = {
            taskId: 'task-1',
            contextId: 'ctx-1',
            status: { state: 'completed', timestamp: new Date().toISOString() },
            targetMindId: 'mind-1',
          };
          mockTaskManager.emit('task:status-update', event);
        }, 0);

        return { id: 'task-1', contextId: 'ctx-1', status: { state: 'submitted', timestamp: new Date().toISOString() } };
      });

      const job = makeJob({
        type: 'prompt',
        payload: { prompt: 'Do something' },
      });

      const result = await runner.run('mind-1', '/path', job);

      expect(result.status).toBe('failed');
      expect(result.error).toContain('not found');
    });
  });
});
