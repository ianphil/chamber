import { Task, TaskExecutor, TaskStatus, type TaskContext } from '@ianphil/ttasks-ts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bridgeRequest } from '../bridge-client';
import { chamberNotify, notifyHandler } from './notify';

vi.mock('../bridge-client', () => ({
  bridgeRequest: vi.fn(),
}));

const bridgeRequestMock = vi.mocked(bridgeRequest);

function contextFor(task: Task): TaskContext {
  return {
    payload: task.payload,
    upstream: new Map(),
  } as unknown as TaskContext;
}

describe('notifyHandler', () => {
  beforeEach(() => {
    bridgeRequestMock.mockReset();
    bridgeRequestMock.mockResolvedValue({ ok: true });
  });

  it('posts the notification to the bridge', async () => {
    const task = chamberNotify({ title: 'Done', body: 'Report ready.' });
    await notifyHandler(contextFor(task));
    expect(bridgeRequestMock).toHaveBeenCalledWith('/notify', { title: 'Done', body: 'Report ready.' });
  });

  it('records a bare-string output when run through the executor', async () => {
    const executor = new TaskExecutor();
    executor.register('chamber:notify', notifyHandler);
    const task = chamberNotify({ title: 'Done', body: 'Report ready.' });

    await executor.execute(task);

    expect(task.status).toBe(TaskStatus.SUCCEEDED);
    expect(task.result?.output).toBe('notification fired');
  });
});
