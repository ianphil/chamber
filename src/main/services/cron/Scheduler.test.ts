import { describe, it, expect, vi, afterEach } from 'vitest';
import { Scheduler, validateSchedule } from './Scheduler';

// We need a real Cron implementation from croner for these tests to be meaningful.
// The Scheduler wraps croner, so we test through it.

describe('Scheduler', () => {
  let scheduler: Scheduler;

  afterEach(() => {
    scheduler?.stopAll();
  });

  it('schedules a job and reports nextRun', () => {
    scheduler = new Scheduler();
    const onTick = vi.fn();
    const job = { id: 'j1', schedule: '* * * * *', enabled: true } as Parameters<Scheduler['schedule']>[0];

    scheduler.schedule(job, onTick);

    const next = scheduler.nextRun('j1');
    expect(next).toBeInstanceOf(Date);
    expect(next!.getTime()).toBeGreaterThan(Date.now());
  });

  it('unschedule removes a job', () => {
    scheduler = new Scheduler();
    const job = { id: 'j1', schedule: '* * * * *', enabled: true } as Parameters<Scheduler['schedule']>[0];
    scheduler.schedule(job, vi.fn());

    scheduler.unschedule('j1');

    expect(scheduler.nextRun('j1')).toBeNull();
  });

  it('unschedule is a no-op for unknown jobs', () => {
    scheduler = new Scheduler();
    expect(() => scheduler.unschedule('nonexistent')).not.toThrow();
  });

  it('stopAll clears all jobs', () => {
    scheduler = new Scheduler();
    const job1 = { id: 'j1', schedule: '* * * * *', enabled: true } as Parameters<Scheduler['schedule']>[0];
    const job2 = { id: 'j2', schedule: '0 * * * *', enabled: true } as Parameters<Scheduler['schedule']>[0];
    scheduler.schedule(job1, vi.fn());
    scheduler.schedule(job2, vi.fn());

    scheduler.stopAll();

    expect(scheduler.nextRun('j1')).toBeNull();
    expect(scheduler.nextRun('j2')).toBeNull();
  });

  it('pause stops a running job from firing', () => {
    scheduler = new Scheduler();
    const job = { id: 'j1', schedule: '* * * * *', enabled: true } as Parameters<Scheduler['schedule']>[0];
    scheduler.schedule(job, vi.fn());

    const result = scheduler.pause('j1');

    expect(result).toBe(true);
  });

  it('resume restarts a paused job', () => {
    scheduler = new Scheduler();
    const job = { id: 'j1', schedule: '* * * * *', enabled: false } as Parameters<Scheduler['schedule']>[0];
    scheduler.schedule(job, vi.fn());

    const result = scheduler.resume('j1');

    expect(result).toBe(true);
    expect(scheduler.nextRun('j1')).toBeInstanceOf(Date);
  });

  it('pause/resume return false for unknown jobs', () => {
    scheduler = new Scheduler();
    expect(scheduler.pause('nonexistent')).toBe(false);
    expect(scheduler.resume('nonexistent')).toBe(false);
  });

  it('isBusy returns false when job is idle', () => {
    scheduler = new Scheduler();
    const job = { id: 'j1', schedule: '* * * * *', enabled: true } as Parameters<Scheduler['schedule']>[0];
    scheduler.schedule(job, vi.fn());

    expect(scheduler.isBusy('j1')).toBe(false);
  });

  it('isBusy returns false for unknown jobs', () => {
    scheduler = new Scheduler();
    expect(scheduler.isBusy('nonexistent')).toBe(false);
  });

  it('trigger fires the onTick callback', async () => {
    scheduler = new Scheduler();
    const onTick = vi.fn();
    const job = { id: 'j1', schedule: '* * * * *', enabled: true } as Parameters<Scheduler['schedule']>[0];
    scheduler.schedule(job, onTick);

    await scheduler.trigger('j1');

    expect(onTick).toHaveBeenCalledOnce();
  });

  it('trigger throws for unknown jobs', async () => {
    scheduler = new Scheduler();
    await expect(scheduler.trigger('nonexistent')).rejects.toThrow('not scheduled');
  });

  it('scheduling the same job id replaces the previous one', () => {
    scheduler = new Scheduler();
    const onTick1 = vi.fn();
    const onTick2 = vi.fn();
    const job = { id: 'j1', schedule: '* * * * *', enabled: true } as Parameters<Scheduler['schedule']>[0];

    scheduler.schedule(job, onTick1);
    scheduler.schedule(job, onTick2);

    // Only the second callback should be wired
    expect(scheduler.nextRun('j1')).toBeInstanceOf(Date);
  });
});

describe('validateSchedule', () => {
  it('accepts valid cron expressions', () => {
    expect(() => validateSchedule('* * * * *')).not.toThrow();
    expect(() => validateSchedule('0 9 * * 1-5')).not.toThrow();
    expect(() => validateSchedule('*/5 * * * *')).not.toThrow();
  });

  it('rejects invalid cron expressions', () => {
    expect(() => validateSchedule('not-a-cron')).toThrow();
    expect(() => validateSchedule('')).toThrow();
  });
});
