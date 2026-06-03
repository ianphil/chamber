import { TaskExecutor, TaskStatus, type TaskContext } from '@ianphil/ttasks-ts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bridgeRequest } from '../bridge-client';
import { a2aHandler, chamberA2A } from './a2a';

vi.mock('../bridge-client', () => ({
  bridgeRequest: vi.fn(),
}));

const bridgeRequestMock = vi.mocked(bridgeRequest);

function contextFor(task: ReturnType<typeof chamberA2A>): TaskContext {
  return {
    payload: task.payload,
    upstream: new Map(),
  } as unknown as TaskContext;
}

describe('chamberA2A', () => {
  beforeEach(() => {
    bridgeRequestMock.mockReset();
    bridgeRequestMock.mockResolvedValue({ id: 'task-123', status: 'submitted' });
  });

  it('posts the delegated A2A request to the bridge', async () => {
    const task = chamberA2A({
      recipient: 'mind-b',
      message: 'draft the report',
      contextId: 'ctx-42',
      referenceTaskIds: ['task-1'],
    });

    await a2aHandler(contextFor(task));

    expect(bridgeRequestMock).toHaveBeenCalledWith('/a2a', {
      recipient: 'mind-b',
      message: 'draft the report',
      contextId: 'ctx-42',
      referenceTaskIds: ['task-1'],
    });
  });

  it('records the serialized A2A result when run through the executor', async () => {
    bridgeRequestMock.mockResolvedValue({ id: 'task-123', status: 'submitted' });
    const executor = new TaskExecutor();
    executor.register('chamber:a2a', a2aHandler);

    const task = chamberA2A({ recipient: 'mind-b', message: 'draft the report' }, { title: 'delegate report' });

    await executor.execute(task);

    expect(task.status).toBe(TaskStatus.SUCCEEDED);
    expect(task.result?.output).toBe(JSON.stringify({ id: 'task-123', status: 'submitted' }));
  });
});
