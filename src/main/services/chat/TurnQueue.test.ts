import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TurnQueue } from './TurnQueue';

describe('TurnQueue', () => {
  let queue: TurnQueue;

  beforeEach(() => {
    queue = new TurnQueue();
  });

  it('executes a single enqueued function', async () => {
    const fn = vi.fn(async () => 42);
    const result = await queue.enqueue('mind-1', fn);
    expect(fn).toHaveBeenCalledOnce();
    expect(result).toBe(42);
  });

  it('serializes concurrent enqueues for the same mindId', async () => {
    const order: string[] = [];

    const p1 = queue.enqueue('mind-1', async () => {
      order.push('start-1');
      await new Promise((r) => setTimeout(r, 50));
      order.push('end-1');
    });

    const p2 = queue.enqueue('mind-1', async () => {
      order.push('start-2');
      await new Promise((r) => setTimeout(r, 10));
      order.push('end-2');
    });

    await Promise.all([p1, p2]);
    expect(order).toEqual(['start-1', 'end-1', 'start-2', 'end-2']);
  });

  it('runs enqueues for different mindIds in parallel', async () => {
    const order: string[] = [];

    const p1 = queue.enqueue('mind-A', async () => {
      order.push('start-A');
      await new Promise((r) => setTimeout(r, 50));
      order.push('end-A');
    });

    const p2 = queue.enqueue('mind-B', async () => {
      order.push('start-B');
      await new Promise((r) => setTimeout(r, 50));
      order.push('end-B');
    });

    await Promise.all([p1, p2]);
    // Both should start before either finishes
    expect(order.indexOf('start-A')).toBeLessThan(order.indexOf('end-A'));
    expect(order.indexOf('start-B')).toBeLessThan(order.indexOf('end-B'));
    expect(order.indexOf('start-B')).toBeLessThan(order.indexOf('end-A'));
  });

  it('propagates errors without blocking the queue', async () => {
    const p1 = queue.enqueue('mind-1', async () => {
      throw new Error('boom');
    });

    await expect(p1).rejects.toThrow('boom');

    const result = await queue.enqueue('mind-1', async () => 'ok');
    expect(result).toBe('ok');
  });

  it('reports busy state per mind', async () => {
    expect(queue.isBusy('mind-1')).toBe(false);

    let resolve!: () => void;
    const blocker = new Promise<void>((r) => { resolve = r; });

    const p = queue.enqueue('mind-1', () => blocker);

    // Allow microtask to start the fn
    await new Promise((r) => setTimeout(r, 0));

    expect(queue.isBusy('mind-1')).toBe(true);
    expect(queue.isBusy('mind-2')).toBe(false);

    resolve();
    await p;

    expect(queue.isBusy('mind-1')).toBe(false);
  });
});
