import { Cron } from 'croner';
import type { CronJob } from './types';

export class Scheduler {
  private jobs = new Map<string, Cron>();

  schedule(job: CronJob, onTick: () => Promise<void> | void): Cron {
    this.unschedule(job.id);

    const scheduled = new Cron(
      job.schedule,
      {
        paused: !job.enabled,
        protect: true,
      },
      async () => {
        await onTick();
      },
    );
    this.jobs.set(job.id, scheduled);
    return scheduled;
  }

  unschedule(jobId: string): void {
    const existing = this.jobs.get(jobId);
    if (!existing) return;
    existing.stop();
    this.jobs.delete(jobId);
  }

  stopAll(): void {
    for (const job of this.jobs.values()) {
      job.stop();
    }
    this.jobs.clear();
  }

  pause(jobId: string): boolean {
    return this.jobs.get(jobId)?.pause() ?? false;
  }

  resume(jobId: string): boolean {
    return this.jobs.get(jobId)?.resume() ?? false;
  }

  nextRun(jobId: string): Date | null {
    return this.jobs.get(jobId)?.nextRun() ?? null;
  }

  isBusy(jobId: string): boolean {
    return this.jobs.get(jobId)?.isBusy() ?? false;
  }

  async trigger(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Cron job ${jobId} is not scheduled`);
    }
    await job.trigger();
  }
}

export function validateSchedule(schedule: string): void {
  const probe = new Cron(schedule, { paused: true });
  try {
    const nextRun = probe.nextRun();
    if (!nextRun) {
      throw new Error(`Cron schedule ${schedule} has no next run`);
    }
  } finally {
    probe.stop();
  }
}
