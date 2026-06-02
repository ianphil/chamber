import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { JobStore } from './JobStore';
import { STORED_CRON_SCHEMA_VERSION } from './types';

let mindPath: string;

beforeEach(() => {
  mindPath = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-jobstore-'));
});

afterEach(() => {
  fs.rmSync(mindPath, { recursive: true, force: true });
});

describe('JobStore', () => {
  it('starts empty for a fresh mind', () => {
    const store = new JobStore(mindPath);
    expect(store.listJobs()).toEqual([]);
  });

  it('creates and persists a v2 job under .chamber/schedules/cron.json', () => {
    const store = new JobStore(mindPath);
    const job = store.createJob({
      name: 'daily',
      schedule: '0 9 * * *',
      scriptPath: '.chamber/automation/daily.ts',
    });
    expect(job.id).toMatch(/^cron-/);
    expect(job.scriptPath).toBe('.chamber/automation/daily.ts');
    expect(job.enabled).toBe(true);

    const file = path.join(mindPath, '.chamber', 'schedules', 'cron.json');
    expect(fs.existsSync(file)).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(onDisk.schemaVersion).toBe(STORED_CRON_SCHEMA_VERSION);
    expect(onDisk.jobs).toHaveLength(1);
  });

  it('updateJob runs the updater and bumps updatedAt', async () => {
    const store = new JobStore(mindPath);
    const job = store.createJob({ name: 'a', schedule: '* * * * *', scriptPath: '.chamber/automation/a.ts' });
    await new Promise((r) => setTimeout(r, 5));
    const updated = store.updateJob(job.id, (j) => ({ ...j, enabled: false }));
    expect(updated.enabled).toBe(false);
    expect(updated.updatedAt).not.toBe(job.updatedAt);
  });

  it('removeJob returns the removed entry and persists the deletion', () => {
    const store = new JobStore(mindPath);
    const job = store.createJob({ name: 'a', schedule: '* * * * *', scriptPath: '.chamber/automation/a.ts' });
    const removed = store.removeJob(job.id);
    expect(removed?.id).toBe(job.id);
    expect(store.listJobs()).toEqual([]);
  });

  it('removeJob returns null for unknown ids', () => {
    const store = new JobStore(mindPath);
    expect(store.removeJob('does-not-exist')).toBeNull();
  });

  it('lazy-migrates a v1 cron.json on first read', () => {
    const legacyDir = path.join(mindPath, '.chamber');
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(
      path.join(legacyDir, 'cron.json'),
      JSON.stringify({
        jobs: [
          { id: 'p1', name: 'p', schedule: '* * * * *', type: 'prompt', payload: { prompt: 'hi' } },
        ],
      }),
    );
    const store = new JobStore(mindPath);
    const jobs = store.listJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe('p1');
    expect(jobs[0].scriptPath).toContain('.chamber/automation/_migrated');
    expect(jobs[0].isMigrated).toBe(true);
  });
});
