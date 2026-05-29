import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runMigrations } from './v1-to-v2';
import { STORED_CRON_SCHEMA_VERSION, type StoredCronJobs } from '../types';

let mindPath: string;

beforeEach(() => {
  mindPath = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-migrate-'));
});

afterEach(() => {
  fs.rmSync(mindPath, { recursive: true, force: true });
});

function writeV1(jobs: unknown[]): string {
  const dir = path.join(mindPath, '.chamber');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'cron.json');
  fs.writeFileSync(file, JSON.stringify({ jobs }));
  return file;
}

function readJobs(): StoredCronJobs {
  const candidates = [
    path.join(mindPath, '.chamber', 'cron.json'),
    path.join(mindPath, '.chamber', 'schedules', 'cron.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  throw new Error('jobs file missing');
}

describe('v1 → v2 cron migration', () => {
  it('translates a prompt job into a chamberPrompt() script', () => {
    writeV1([
      {
        id: 'job-1',
        name: 'Daily standup',
        schedule: '0 9 * * *',
        type: 'prompt',
        payload: { prompt: 'Give me a status update' },
        enabled: true,
      },
    ]);
    runMigrations(mindPath);
    const state = readJobs();
    expect(state.schemaVersion).toBe(STORED_CRON_SCHEMA_VERSION);
    expect(state.jobs).toHaveLength(1);
    const job = state.jobs[0];
    expect(job.id).toBe('job-1');
    expect(job.scriptPath).toMatch(/\.chamber[\\/]automation[\\/]_migrated[\\/].+\.ts$/);
    expect(job.isMigrated).toBe(true);
    const scriptAbs = path.join(mindPath, job.scriptPath);
    const src = fs.readFileSync(scriptAbs, 'utf8');
    expect(src).toContain('chamberPrompt');
    expect(src).toContain('Give me a status update');
  });

  it('translates shell, webhook, and notification jobs', () => {
    writeV1([
      { id: 'shell-1', name: 'sh', schedule: '* * * * *', type: 'shell', payload: { command: 'echo', args: ['hi'] } },
      { id: 'web-1', name: 'wh', schedule: '* * * * *', type: 'webhook', payload: { url: 'https://example.com', method: 'POST' } },
      { id: 'notif-1', name: 'n', schedule: '* * * * *', type: 'notification', payload: { title: 'T', body: 'B' } },
    ]);
    runMigrations(mindPath);
    const state = readJobs();
    expect(state.jobs).toHaveLength(3);
    const byId = Object.fromEntries(state.jobs.map((j) => [j.id, j]));
    expect(fs.readFileSync(path.join(mindPath, byId['shell-1'].scriptPath), 'utf8')).toContain('Task.bash');
    expect(fs.readFileSync(path.join(mindPath, byId['web-1'].scriptPath), 'utf8')).toContain('https://example.com');
    expect(fs.readFileSync(path.join(mindPath, byId['notif-1'].scriptPath), 'utf8')).toContain('chamberNotify');
  });

  it('writes a backup at cron.v1.backup.json and is idempotent', () => {
    const file = writeV1([
      { id: 'p', name: 'p', schedule: '* * * * *', type: 'prompt', payload: { prompt: 'hi' } },
    ]);
    runMigrations(mindPath);
    const backup = path.join(path.dirname(file), 'cron.v1.backup.json');
    expect(fs.existsSync(backup)).toBe(true);
    const before = fs.readFileSync(backup, 'utf8');
    runMigrations(mindPath); // second run — no-op
    expect(fs.readFileSync(backup, 'utf8')).toBe(before);
  });

  it('quarantines invalid jobs in cron.migration-errors.json but keeps cron unblocked', () => {
    writeV1([
      { id: 'good', name: 'g', schedule: '* * * * *', type: 'prompt', payload: { prompt: 'ok' } },
      { id: 'bad', name: 'b', schedule: '* * * * *', type: 'prompt', payload: {} },
    ]);
    runMigrations(mindPath);
    const state = readJobs();
    expect(state.jobs.map((j) => j.id)).toEqual(['good']);
    const errorsPath = path.join(mindPath, '.chamber', 'cron.migration-errors.json');
    expect(fs.existsSync(errorsPath)).toBe(true);
    const errors = JSON.parse(fs.readFileSync(errorsPath, 'utf8'));
    expect(errors.errors).toHaveLength(1);
    expect(errors.errors[0].legacyId).toBe('bad');
  });

  it('is a no-op on already-migrated stores', () => {
    const file = path.join(mindPath, '.chamber', 'cron.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({
        schemaVersion: STORED_CRON_SCHEMA_VERSION,
        jobs: [{ id: 'x', name: 'x', schedule: '* * * * *', scriptPath: '.chamber/automation/x.ts', enabled: true, createdAt: '', updatedAt: '' }],
      }),
    );
    runMigrations(mindPath);
    expect(fs.existsSync(path.join(mindPath, '.chamber', 'cron.v1.backup.json'))).toBe(false);
  });

  it('does nothing if no cron file exists', () => {
    expect(() => runMigrations(mindPath)).not.toThrow();
    expect(fs.existsSync(path.join(mindPath, '.chamber'))).toBe(false);
  });
});
