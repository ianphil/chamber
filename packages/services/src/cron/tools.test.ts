import { describe, it, expect, vi } from 'vitest';
import { buildCronTools } from './tools';
import type { CronService } from './CronService';

function makeServiceStub(overrides: Partial<CronService> = {}): CronService {
  const stub = {
    createJob: vi.fn(),
    listJobs: vi.fn(() => []),
    removeJob: vi.fn(),
    enableJob: vi.fn(),
    disableJob: vi.fn(),
    runNow: vi.fn(),
    listRuns: vi.fn(() => []),
    runScript: vi.fn(),
    validateScript: vi.fn(async () => ({ ok: true, output: '' })),
    getRunDetail: vi.fn(() => null),
    ...overrides,
  };
  return stub as unknown as CronService;
}

describe('buildCronTools', () => {
  it('exposes the v2 tool surface', () => {
    const tools = buildCronTools('mind', '/tmp/mind', makeServiceStub());
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'automation_run',
      'automation_validate',
      'cron_create',
      'cron_disable',
      'cron_enable',
      'cron_history',
      'cron_list',
      'cron_remove',
      'cron_run_detail',
      'cron_run_now',
    ]);
  });

  it('cron_create forwards the flat schema to CronService.createJob', async () => {
    const svc = makeServiceStub();
    const tools = buildCronTools('mind', '/tmp/mind', svc);
    const tool = tools.find((t) => t.name === 'cron_create');
    expect(tool).toBeDefined();
    await tool!.handler({
      name: 'd', schedule: '0 9 * * *', scriptPath: '.chamber/automation/d.ts',
    });
    expect(svc.createJob).toHaveBeenCalledWith('mind', '/tmp/mind', {
      name: 'd', schedule: '0 9 * * *', scriptPath: '.chamber/automation/d.ts',
    });
  });

  it('automation_validate calls cronService.validateScript', async () => {
    const svc = makeServiceStub();
    const tools = buildCronTools('mind', '/tmp/mind', svc);
    const tool = tools.find((t) => t.name === 'automation_validate');
    await tool!.handler({ scriptPath: '.chamber/automation/x.ts' });
    expect(svc.validateScript).toHaveBeenCalledWith('mind', '.chamber/automation/x.ts');
  });

  it('cron_run_detail calls cronService.getRunDetail', async () => {
    const svc = makeServiceStub();
    const tools = buildCronTools('mind', '/tmp/mind', svc);
    const tool = tools.find((t) => t.name === 'cron_run_detail');
    await tool!.handler({ runId: 'r-1' });
    expect(svc.getRunDetail).toHaveBeenCalledWith('mind', 'r-1');
  });
});
