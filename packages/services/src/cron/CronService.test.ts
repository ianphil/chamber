import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CronService } from './CronService';
import type { ScriptRunner, ScriptRunResult } from './ScriptRunner';
import type { CronJobRunRecord, CronRunDetail } from './types';
import type { CronRunStore } from './CronRunStore';

let mindPath: string;
let mindId: string;

beforeEach(() => {
  mindPath = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-cronsvc-'));
  fs.mkdirSync(path.join(mindPath, '.chamber', 'automation'), { recursive: true });
  fs.writeFileSync(path.join(mindPath, '.chamber', 'automation', 'foo.ts'), '// noop');
  mindId = 'mind-1';
});

afterEach(() => {
  fs.rmSync(mindPath, { recursive: true, force: true });
});

function makeFakeRunner(result: ScriptRunResult): ScriptRunner {
  return {
    run: vi.fn(async () => result),
    validateScript: vi.fn(async () => ({ ok: true, output: '' })),
    cancel: vi.fn(() => false),
    cancelAll: vi.fn(),
  } as unknown as ScriptRunner;
}

class InMemoryRunStore implements CronRunStore {
  readonly runs: CronJobRunRecord[] = [];
  listRuns(mid: string, jobId?: string): CronJobRunRecord[] {
    return this.runs.filter((r) => r.mindId === mid && (!jobId || r.jobId === jobId));
  }
  hasRun(id: string): boolean { return this.runs.some((r) => r.id === id); }
  hasActiveRun(): boolean { return false; }
  recordRun(run: Omit<CronJobRunRecord, 'id'>): CronJobRunRecord {
    const rec: CronJobRunRecord = { ...run, id: `run-${this.runs.length + 1}` };
    this.runs.push(rec);
    return rec;
  }
  getRunDetail(runId: string): CronRunDetail | null {
    const r = this.runs.find((x) => x.id === runId);
    return r ? { run: r, graph: [] } : null;
  }
}

describe('CronService (v2)', () => {
  it('creates, lists, and removes a cron job through the JobStore', async () => {
    const svc = new CronService({
      scriptRunner: makeFakeRunner({ status: 'completed', graphId: 'g1', output: 'ok' }),
      createCronRunStore: () => new InMemoryRunStore(),
    });
    await svc.activateMind(mindId, mindPath);
    const job = svc.createJob(mindId, mindPath, {
      name: 'd',
      schedule: '0 9 * * *',
      scriptPath: '.chamber/automation/foo.ts',
    });
    const list = svc.listJobs(mindId, mindPath);
    expect(list.map((j) => j.id)).toEqual([job.id]);
    expect(list[0].nextRun).toBeTruthy();
    svc.removeJob(mindId, job.id);
    expect(svc.listJobs(mindId, mindPath)).toEqual([]);
    await svc.releaseMind(mindId);
  });

  it('runNow spawns the script and records the run', async () => {
    const runner = makeFakeRunner({ status: 'completed', graphId: 'g-1', output: 'ran' });
    const runStore = new InMemoryRunStore();
    const svc = new CronService({ scriptRunner: runner, createCronRunStore: () => runStore });
    await svc.activateMind(mindId, mindPath);
    const job = svc.createJob(mindId, mindPath, {
      name: 'd', schedule: '0 9 * * *', scriptPath: '.chamber/automation/foo.ts',
    });
    const record = await svc.runNow(mindId, job.id);
    expect(record.status).toBe('completed');
    expect(record.graphId).toBe('g-1');
    expect(record.source).toBe('manual');
    expect(runner.run).toHaveBeenCalledWith(expect.objectContaining({
      mindId, mindPath, scriptPath: '.chamber/automation/foo.ts',
    }));
    expect(runStore.runs).toHaveLength(1);
    await svc.releaseMind(mindId);
  });

  it('runScript executes an ad-hoc script without persisting a cron job', async () => {
    const runStore = new InMemoryRunStore();
    const svc = new CronService({
      scriptRunner: makeFakeRunner({ status: 'completed', graphId: 'g-x', output: 'x' }),
      createCronRunStore: () => runStore,
    });
    await svc.activateMind(mindId, mindPath);
    const rec = await svc.runScript(mindId, '.chamber/automation/foo.ts');
    expect(rec.jobId).toBe('__ad_hoc__');
    expect(svc.listJobs(mindId, mindPath)).toEqual([]);
    await svc.releaseMind(mindId);
  });

  it('validateScript delegates to ScriptRunner', async () => {
    const runner = makeFakeRunner({ status: 'completed', graphId: 'g', output: '' });
    const svc = new CronService({ scriptRunner: runner, createCronRunStore: () => new InMemoryRunStore() });
    await svc.activateMind(mindId, mindPath);
    const result = await svc.validateScript(mindId, '.chamber/automation/foo.ts');
    expect(result.ok).toBe(true);
    expect(runner.validateScript).toHaveBeenCalled();
    await svc.releaseMind(mindId);
  });

  it('getRunDetail returns null for runs that do not belong to the mind', async () => {
    const runStore = new InMemoryRunStore();
    const svc = new CronService({
      scriptRunner: makeFakeRunner({ status: 'completed', graphId: 'g', output: '' }),
      createCronRunStore: () => runStore,
    });
    await svc.activateMind(mindId, mindPath);
    // Plant a run owned by a different mind in the store directly.
    runStore.runs.push({
      id: 'r-other', mindId: 'mind-other', jobId: 'j', status: 'completed',
      startedAt: '', endedAt: '', source: 'manual',
    });
    expect(svc.getRunDetail(mindId, 'r-other')).toBeNull();
    expect(svc.getRunDetail(mindId, 'r-missing')).toBeNull();
    await svc.releaseMind(mindId);
  });
});
