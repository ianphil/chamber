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

  it('relocates legacy cron.json into .chamber/schedules while keeping jobs readable', () => {
    const mindPath = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-cron-store-'));
    tempDirs.push(mindPath);
    const chamberDir = path.join(mindPath, '.chamber');
    fs.mkdirSync(chamberDir, { recursive: true });
    fs.writeFileSync(path.join(chamberDir, 'cron.json'), JSON.stringify({
      jobs: [{
        id: 'cron-legacy',
        name: 'Legacy',
        schedule: '* * * * *',
        type: 'notification',
        payload: { title: 'Legacy', body: 'Body' },
        enabled: true,
        createdAt: '2026-05-21T00:00:00.000Z',
        updatedAt: '2026-05-21T00:00:00.000Z',
      }],
    }));

    const store = new JobStore(mindPath);

    expect(fs.existsSync(path.join(chamberDir, 'cron.json'))).toBe(false);
    expect(fs.existsSync(path.join(chamberDir, 'schedules', 'cron.json'))).toBe(true);
    expect(store.listJobs()).toHaveLength(1);
    expect(store.listJobs()[0].id).toBe('cron-legacy');
  });

  it('prefers the legacy cron.json path for one-release rollback compatibility', () => {
    const mindPath = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-cron-store-'));
    tempDirs.push(mindPath);
    const chamberDir = path.join(mindPath, '.chamber');
    const schedulesDir = path.join(chamberDir, 'schedules');
    fs.mkdirSync(schedulesDir, { recursive: true });
    fs.writeFileSync(path.join(chamberDir, 'cron.json'), JSON.stringify({
      jobs: [{
        id: 'cron-legacy',
        name: 'Legacy',
        schedule: '* * * * *',
        type: 'notification',
        payload: { title: 'Legacy', body: 'Body' },
        enabled: true,
        createdAt: '2026-05-21T00:00:00.000Z',
        updatedAt: '2026-05-21T00:00:00.000Z',
      }],
    }));
    fs.writeFileSync(path.join(schedulesDir, 'cron.json'), JSON.stringify({ jobs: [] }));

    const store = new JobStore(mindPath);

    expect(store.listJobs()[0].id).toBe('cron-legacy');
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

  it('persists cron-runs.json grouped by job with run shape for every current job type and skipped runs', () => {
    const { mindPath, store } = makeStore(10);
    const prompt = store.createJob({
      name: 'Prompt',
      schedule: '* * * * *',
      type: 'prompt',
      payload: { prompt: 'Summarize' },
    });
    const shell = store.createJob({
      name: 'Shell',
      schedule: '* * * * *',
      type: 'shell',
      payload: { command: 'node', args: ['--version'] },
    });
    const webhook = store.createJob({
      name: 'Webhook',
      schedule: '* * * * *',
      type: 'webhook',
      payload: { url: 'https://example.invalid/hook' },
    });
    const notification = store.createJob({
      name: 'Notify',
      schedule: '* * * * *',
      type: 'notification',
      payload: { title: 'Ready', body: 'Done' },
    });

    store.appendRun({
      mindId: 'mind-1',
      jobId: prompt.id,
      type: 'prompt',
      status: 'completed',
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: '2026-01-01T00:00:01.000Z',
      taskId: 'task-1',
      output: 'ok',
      source: 'scheduled',
    });
    store.appendRun({
      mindId: 'mind-1',
      jobId: shell.id,
      type: 'shell',
      status: 'failed',
      startedAt: '2026-01-01T00:01:00.000Z',
      endedAt: '2026-01-01T00:01:01.000Z',
      error: 'exit 1',
      source: 'manual',
    });
    store.appendRun({
      mindId: 'mind-1',
      jobId: webhook.id,
      type: 'webhook',
      status: 'timed-out',
      startedAt: '2026-01-01T00:02:00.000Z',
      endedAt: '2026-01-01T00:02:30.000Z',
      error: 'timeout',
      source: 'resume',
    });
    store.appendRun({
      mindId: 'mind-1',
      jobId: notification.id,
      type: 'notification',
      status: 'completed',
      startedAt: '2026-01-01T00:03:00.000Z',
      endedAt: '2026-01-01T00:03:01.000Z',
      output: 'sent',
      source: 'scheduled',
    });
    store.appendRun({
      mindId: 'mind-1',
      jobId: prompt.id,
      type: 'prompt',
      status: 'skipped',
      startedAt: '2026-01-01T00:04:00.000Z',
      endedAt: '2026-01-01T00:04:00.000Z',
      error: 'previous run still active',
      source: 'scheduled',
    });

    const raw = JSON.parse(
      fs.readFileSync(path.join(mindPath, '.chamber', 'cron-runs.json'), 'utf8'),
    ) as { runs: Record<string, unknown[]> };

    expect(Object.keys(raw.runs).sort()).toEqual([
      prompt.id,
      shell.id,
      webhook.id,
      notification.id,
    ].sort());
    expect(raw.runs[prompt.id]).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^cron-run-/),
        jobId: prompt.id,
        mindId: 'mind-1',
        type: 'prompt',
        status: 'completed',
        taskId: 'task-1',
        output: 'ok',
        source: 'scheduled',
      }),
      expect.objectContaining({
        id: expect.stringMatching(/^cron-run-/),
        jobId: prompt.id,
        mindId: 'mind-1',
        type: 'prompt',
        status: 'skipped',
        error: 'previous run still active',
        source: 'scheduled',
      }),
    ]);
    expect(raw.runs[shell.id]).toEqual([
      expect.objectContaining({ type: 'shell', status: 'failed', error: 'exit 1', source: 'manual' }),
    ]);
    expect(raw.runs[webhook.id]).toEqual([
      expect.objectContaining({ type: 'webhook', status: 'timed-out', error: 'timeout', source: 'resume' }),
    ]);
    expect(raw.runs[notification.id]).toEqual([
      expect.objectContaining({ type: 'notification', status: 'completed', output: 'sent', source: 'scheduled' }),
    ]);
  });
});
