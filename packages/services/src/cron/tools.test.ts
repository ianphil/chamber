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

  it('automation_validate returns an explicit VALIDATED status on success', async () => {
    const svc = makeServiceStub({ validateScript: vi.fn(async () => ({ ok: true, output: '' })) });
    const tools = buildCronTools('mind', '/tmp/mind', svc);
    const tool = tools.find((t) => t.name === 'automation_validate');
    const result = await tool!.handler({ scriptPath: '.chamber/automation/x.ts' });
    expect(result).toMatchObject({ ok: true, status: 'VALIDATED', output: '' });
    expect((result as { message: string }).message).toContain('VALIDATED');
    expect((result as { message: string }).message).toContain('.chamber/automation/x.ts');
  });

  it('automation_validate returns NOT_VALIDATED with the tsc errors on failure', async () => {
    const svc = makeServiceStub({
      validateScript: vi.fn(async () => ({ ok: false, output: 'x.ts(3,1): error TS2304: Cannot find name foo.' })),
    });
    const tools = buildCronTools('mind', '/tmp/mind', svc);
    const tool = tools.find((t) => t.name === 'automation_validate');
    const result = await tool!.handler({ scriptPath: '.chamber/automation/x.ts' });
    expect(result).toMatchObject({ ok: false, status: 'NOT_VALIDATED' });
    expect((result as { message: string }).message).toContain('type errors');
    expect((result as { output: string }).output).toContain('error TS2304');
  });

  it('automation_validate flags toolchain-unavailable distinctly from type errors', async () => {
    const svc = makeServiceStub({
      validateScript: vi.fn(async () => ({ ok: false, output: 'automation_validate unavailable: typescript not found at ...' })),
    });
    const tools = buildCronTools('mind', '/tmp/mind', svc);
    const tool = tools.find((t) => t.name === 'automation_validate');
    const result = await tool!.handler({ scriptPath: '.chamber/automation/x.ts' });
    expect(result).toMatchObject({ ok: false, status: 'NOT_VALIDATED' });
    expect((result as { message: string }).message).toContain('toolchain was unavailable');
    expect((result as { message: string }).message).not.toContain('type errors');
  });

  it('cron_run_detail calls cronService.getRunDetail', async () => {
    const svc = makeServiceStub();
    const tools = buildCronTools('mind', '/tmp/mind', svc);
    const tool = tools.find((t) => t.name === 'cron_run_detail');
    await tool!.handler({ runId: 'r-1' });
    expect(svc.getRunDetail).toHaveBeenCalledWith('mind', 'r-1');
  });
});
