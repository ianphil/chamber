import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CronService } from './CronService';
import { buildCronTools } from './tools';

const mockService = {
  createJob: vi.fn(),
  listJobs: vi.fn(),
  removeJob: vi.fn(),
  enableJob: vi.fn(),
  disableJob: vi.fn(),
  runNow: vi.fn(),
  listRuns: vi.fn(),
};

describe('buildCronTools', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 7 tools with correct names', () => {
    const tools = buildCronTools('mind-1', '/path/to/mind', mockService as unknown as CronService);

    expect(tools).toHaveLength(7);
    const names = tools.map((t) => t.name);
    expect(names).toEqual([
      'cron_create',
      'cron_list',
      'cron_remove',
      'cron_enable',
      'cron_disable',
      'cron_run_now',
      'cron_history',
    ]);
  });

  it('cron_create dispatches to cronService.createJob', async () => {
    const tools = buildCronTools('mind-1', '/path', mockService as unknown as CronService);
    const create = tools.find((t) => t.name === 'cron_create')!;

    const input = { name: 'Test', schedule: '* * * * *', type: 'notification', payload: { title: 'Hi', body: 'World' } };
    await create.handler(input);

    expect(mockService.createJob).toHaveBeenCalledWith('mind-1', '/path', input);
  });

  it('cron_list dispatches to cronService.listJobs', async () => {
    const tools = buildCronTools('mind-1', '/path', mockService as unknown as CronService);
    const list = tools.find((t) => t.name === 'cron_list')!;

    await list.handler({});

    expect(mockService.listJobs).toHaveBeenCalledWith('mind-1', '/path');
  });

  it('cron_remove dispatches to cronService.removeJob', async () => {
    const tools = buildCronTools('mind-1', '/path', mockService as unknown as CronService);
    const remove = tools.find((t) => t.name === 'cron_remove')!;

    await remove.handler({ id: 'job-123' });

    expect(mockService.removeJob).toHaveBeenCalledWith('mind-1', 'job-123');
  });

  it('cron_enable dispatches to cronService.enableJob', async () => {
    const tools = buildCronTools('mind-1', '/path', mockService as unknown as CronService);
    const enable = tools.find((t) => t.name === 'cron_enable')!;

    await enable.handler({ id: 'job-123' });

    expect(mockService.enableJob).toHaveBeenCalledWith('mind-1', 'job-123');
  });

  it('cron_disable dispatches to cronService.disableJob', async () => {
    const tools = buildCronTools('mind-1', '/path', mockService as unknown as CronService);
    const disable = tools.find((t) => t.name === 'cron_disable')!;

    await disable.handler({ id: 'job-123' });

    expect(mockService.disableJob).toHaveBeenCalledWith('mind-1', 'job-123');
  });

  it('cron_run_now dispatches to cronService.runNow', async () => {
    const tools = buildCronTools('mind-1', '/path', mockService as unknown as CronService);
    const runNow = tools.find((t) => t.name === 'cron_run_now')!;

    await runNow.handler({ id: 'job-123' });

    expect(mockService.runNow).toHaveBeenCalledWith('mind-1', 'job-123');
  });

  it('cron_history dispatches to cronService.listRuns', async () => {
    const tools = buildCronTools('mind-1', '/path', mockService as unknown as CronService);
    const history = tools.find((t) => t.name === 'cron_history')!;

    await history.handler({ jobId: 'job-123' });

    expect(mockService.listRuns).toHaveBeenCalledWith('mind-1', 'job-123');
  });

  it('cron_history passes undefined when no jobId provided', async () => {
    const tools = buildCronTools('mind-1', '/path', mockService as unknown as CronService);
    const history = tools.find((t) => t.name === 'cron_history')!;

    await history.handler({});

    expect(mockService.listRuns).toHaveBeenCalledWith('mind-1', undefined);
  });
});
