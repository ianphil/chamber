import { describe, it, expect, vi } from 'vitest';
import type { JobSnapshot, JobStore } from 'chamber-copilot';
import { MindScopedJobs } from './MindScopedJobs';

function snap(jobId: string, overrides: Partial<JobSnapshot> = {}): JobSnapshot {
  return {
    jobId,
    cwd: '/tmp',
    sessionId: `sess-${jobId}`,
    status: 'idle',
    eventLog: [],
    pendingApproval: null,
    createdAt: 0,
    lastUpdateAt: 0,
    lastStopReason: 'end_turn',
    ...overrides,
  };
}

interface FakeStore {
  delegate: ReturnType<typeof vi.fn>;
  respond: ReturnType<typeof vi.fn>;
  approve: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  status: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
}

function buildStore(initial: JobSnapshot[] = []): FakeStore {
  const snapshots = new Map<string, JobSnapshot>(initial.map((s) => [s.jobId, s]));
  let counter = 0;
  const store = {
    delegate: vi.fn(async ({ cwd }: { cwd: string; prompt: string }) => {
      counter += 1;
      const jobId = `job-${counter}`;
      snapshots.set(jobId, snap(jobId, { cwd }));
      return { jobId, sessionId: `sess-${jobId}` };
    }),
    respond: vi.fn(async () => {}),
    approve: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    status: vi.fn((jobId: string): JobSnapshot => {
      const found = snapshots.get(jobId);
      if (!found) throw new Error(`Unknown job_id: ${jobId}`);
      return found;
    }),
    list: vi.fn((): JobSnapshot[] => Array.from(snapshots.values())),
  };
  return store as FakeStore;
}

function asJobStore(store: FakeStore): JobStore {
  return store as unknown as JobStore;
}

describe('MindScopedJobs', () => {
  it('namespaces returned job_id with the mind prefix', async () => {
    const store = buildStore();
    const scoped = new MindScopedJobs(asJobStore(store), 'mind-a');

    const result = await scoped.delegate({ cwd: '/repo', prompt: 'hello' });

    expect(result.jobId).toBe('mind-a:job-1');
    expect(store.delegate).toHaveBeenCalledWith({ cwd: '/repo', prompt: 'hello' });
  });

  it('strips the prefix before calling through on respond/approve/cancel/status', async () => {
    const store = buildStore();
    const scoped = new MindScopedJobs(asJobStore(store), 'mind-a');
    const { jobId } = await scoped.delegate({ cwd: '/repo', prompt: 'p' });

    await scoped.respond(jobId, 'next');
    await scoped.approve(jobId, 'approval-7', 'allow_once');
    await scoped.cancel(jobId);
    const status = scoped.status(jobId);

    expect(store.respond).toHaveBeenCalledWith('job-1', 'next');
    expect(store.approve).toHaveBeenCalledWith('job-1', 'approval-7', 'allow_once');
    expect(store.cancel).toHaveBeenCalledWith('job-1');
    expect(store.status).toHaveBeenCalledWith('job-1');
    expect(status.jobId).toBe('mind-a:job-1');
  });

  it('rejects status against a job owned by a different mind with the same UnknownJob shape', async () => {
    const store = buildStore();
    const mindA = new MindScopedJobs(asJobStore(store), 'mind-a');
    const mindB = new MindScopedJobs(asJobStore(store), 'mind-b');
    const a = await mindA.delegate({ cwd: '/repo-a', prompt: 'a' });

    expect(() => mindB.status(a.jobId)).toThrow(/Unknown job_id/);
  });

  it('rejects respond/approve/cancel from a different mind without leaking the real job_id', async () => {
    const store = buildStore();
    const mindA = new MindScopedJobs(asJobStore(store), 'mind-a');
    const mindB = new MindScopedJobs(asJobStore(store), 'mind-b');
    const a = await mindA.delegate({ cwd: '/repo-a', prompt: 'a' });

    await expect(mindB.respond(a.jobId, 'inject')).rejects.toThrow(/Unknown job_id/);
    await expect(mindB.approve(a.jobId, 'app-1', 'allow_once')).rejects.toThrow(/Unknown job_id/);
    await expect(mindB.cancel(a.jobId)).rejects.toThrow(/Unknown job_id/);
    expect(store.respond).not.toHaveBeenCalled();
    expect(store.approve).not.toHaveBeenCalled();
    expect(store.cancel).not.toHaveBeenCalled();
  });

  it('list returns only jobs owned by this mind, with namespaced job_ids', async () => {
    const store = buildStore();
    const mindA = new MindScopedJobs(asJobStore(store), 'mind-a');
    const mindB = new MindScopedJobs(asJobStore(store), 'mind-b');

    const a1 = await mindA.delegate({ cwd: '/a', prompt: 'a1' });
    await mindB.delegate({ cwd: '/b', prompt: 'b1' });
    const a2 = await mindA.delegate({ cwd: '/a', prompt: 'a2' });

    const aJobs = mindA.list();
    const bJobs = mindB.list();

    expect(aJobs.map((j) => j.jobId).sort()).toEqual([a1.jobId, a2.jobId].sort());
    expect(bJobs.map((j) => j.jobId)).toEqual(['mind-b:job-2']);
  });

  it('list filter is forwarded to the inner store', async () => {
    const store = buildStore();
    const scoped = new MindScopedJobs(asJobStore(store), 'mind-a');
    await scoped.delegate({ cwd: '/repo', prompt: 'p' });

    scoped.list({ status: 'running', cwd: '/repo' });

    expect(store.list).toHaveBeenCalledWith({ status: 'running', cwd: '/repo' });
  });

  it('rejects malformed job_ids (no separator, leading separator, empty)', () => {
    const store = buildStore();
    const scoped = new MindScopedJobs(asJobStore(store), 'mind-a');

    expect(() => scoped.status('no-prefix')).toThrow(/Unknown job_id/);
    expect(() => scoped.status(':orphan')).toThrow(/Unknown job_id/);
    expect(() => scoped.status('mind-a:')).toThrow(/Unknown job_id/);
    expect(() => scoped.status('')).toThrow(/Unknown job_id/);
  });

  it('releaseAll cancels every owned job and forgets ownership', async () => {
    const store = buildStore();
    const scoped = new MindScopedJobs(asJobStore(store), 'mind-a');
    const j1 = await scoped.delegate({ cwd: '/a', prompt: 'p1' });
    const j2 = await scoped.delegate({ cwd: '/a', prompt: 'p2' });

    await scoped.releaseAll();

    expect(store.cancel).toHaveBeenCalledWith('job-1');
    expect(store.cancel).toHaveBeenCalledWith('job-2');
    expect(() => scoped.status(j1.jobId)).toThrow(/Unknown job_id/);
    expect(() => scoped.status(j2.jobId)).toThrow(/Unknown job_id/);
  });

  it('releaseAll swallows cancel failures so a release can never throw', async () => {
    const store = buildStore();
    store.cancel.mockRejectedValueOnce(new Error('already terminal'));
    const scoped = new MindScopedJobs(asJobStore(store), 'mind-a');
    await scoped.delegate({ cwd: '/a', prompt: 'p1' });
    await scoped.delegate({ cwd: '/a', prompt: 'p2' });

    await expect(scoped.releaseAll()).resolves.toBeUndefined();
    expect(store.cancel).toHaveBeenCalledTimes(2);
  });
});
