import { Task, TaskExecutor, TaskStatus, type TaskContext } from '@ianphil/ttasks-ts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { httpHandler } from './http';

function httpTask(input: Record<string, unknown>): Task {
  return Task.custom('http', JSON.stringify(input), { title: 'http' });
}

function contextFor(task: Task): TaskContext {
  return {
    payload: task.payload,
    signal: undefined,
    upstream: new Map(),
  } as unknown as TaskContext;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('httpHandler', () => {
  it('returns the response body as a bare string on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('hello body', { status: 200 })));
    const returned = await httpHandler(contextFor(httpTask({ url: 'https://example.com' })));
    expect(returned).toBe('hello body');
  });

  it('records the body as result.output when run through the executor', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok payload', { status: 200 })));
    const executor = new TaskExecutor();
    executor.register('http', httpHandler);
    const task = httpTask({ url: 'https://example.com' });

    await executor.execute(task);

    expect(task.status).toBe(TaskStatus.SUCCEEDED);
    expect(task.result?.output).toBe('ok payload');
  });

  it('throws on a non-2xx response so the task fails through the executor', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500, statusText: 'Server Error' })));
    const executor = new TaskExecutor();
    executor.register('http', httpHandler);
    const task = httpTask({ url: 'https://example.com' });

    await expect(executor.execute(task)).rejects.toThrow(/HTTP 500/);
    expect(task.status).toBe(TaskStatus.FAILED);
  });

  it('caps the error body preview', async () => {
    const big = 'x'.repeat(2_000);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(big, { status: 400 })));

    await expect(httpHandler(contextFor(httpTask({ url: 'https://example.com' })))).rejects.toThrow(/truncated 1500 chars/);
  });
});
