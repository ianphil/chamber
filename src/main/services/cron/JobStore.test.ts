import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { JobStore } from './JobStore';

const tempDirs: string[] = [];

function makeStore(runLimit = 2) {
  const mindPath = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-cron-store-'));
  tempDirs.push(mindPath);
  return {
    mindPath,
    store: new JobStore(mindPath, runLimit),
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('JobStore', () => {
  it('creates and persists jobs', () => {
    const { mindPath, store } = makeStore();

    const created = store.createJob({
      name: 'Daily prompt',
      schedule: '0 9 * * *',
      type: 'prompt',
      payload: { prompt: 'Summarize the inbox' },
    });

    const reloaded = new JobStore(mindPath);
    const jobs = reloaded.listJobs();

    expect(created.id).toMatch(/^cron-/);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].name).toBe('Daily prompt');
  });

  it('updates jobs and trims run history per job', () => {
    const { store } = makeStore(2);
    const created = store.createJob({
      name: 'Digest',
      schedule: '0 12 * * *',
      type: 'notification',
      payload: { title: 'Digest', body: 'Ready' },
    });

    store.updateJob(created.id, (job) => ({ ...job, enabled: false }));
    store.appendRun({
      mindId: 'mind-1',
      jobId: created.id,
      type: created.type,
      status: 'completed',
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: '2026-01-01T00:00:01.000Z',
      source: 'manual',
    });
    store.appendRun({
      mindId: 'mind-1',
      jobId: created.id,
      type: created.type,
      status: 'failed',
      startedAt: '2026-01-02T00:00:00.000Z',
      endedAt: '2026-01-02T00:00:01.000Z',
      error: 'boom',
      source: 'manual',
    });
    store.appendRun({
      mindId: 'mind-1',
      jobId: created.id,
      type: created.type,
      status: 'completed',
      startedAt: '2026-01-03T00:00:00.000Z',
      endedAt: '2026-01-03T00:00:01.000Z',
      source: 'manual',
    });

    const updated = store.getJob(created.id);
    const runs = store.listRuns(created.id);

    expect(updated?.enabled).toBe(false);
    expect(runs).toHaveLength(2);
    expect(runs[0].startedAt).toBe('2026-01-03T00:00:00.000Z');
    expect(runs[1].startedAt).toBe('2026-01-02T00:00:00.000Z');
  });
});
