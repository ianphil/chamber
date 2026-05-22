import { describe, it, expect, vi } from 'vitest';
import type { JobSnapshot, JobStore } from 'chamber-copilot';
import { InMemoryLedgerStore, TaskLedger } from '../ledger';
import { MindScopedJobs } from './MindScopedJobs';

function snap(jobId: string, overrides: Partial<JobSnapshot> = {}): JobSnapshot {
  return {
    jobId,
    cwd: '/tmp',
    sessionId: `sess-${jobId}`,
    status: 'idle',
    permissionMode: 'safe',
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

  it('uses the same UnknownJob shape for missing, wrong-owner, and released jobs', async () => {
    const store = buildStore();
    const mindA = new MindScopedJobs(asJobStore(store), 'mind-a');
    const mindB = new MindScopedJobs(asJobStore(store), 'mind-b');
    const a = await mindA.delegate({ cwd: '/repo-a', prompt: 'a' });

    expect(() => mindA.status('mind-a:missing')).toThrow('Unknown job_id: mind-a:missing');
    expect(() => mindB.status(a.jobId)).toThrow(`Unknown job_id: ${a.jobId}`);

    await mindA.releaseAll();

    expect(() => mindA.status(a.jobId)).toThrow(`Unknown job_id: ${a.jobId}`);
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

  describe('separator robustness (issue #261)', () => {
    // Real Chamber mindIds are derived from a directory basename plus a
    // 4-char hex suffix (see generateMindId.ts). On Linux/macOS a basename
    // can contain ':', so a mindId of the shape 'foo:bar-abcd' is not a
    // theoretical concern. The scope/unscope split must therefore tolerate
    // colons in the mindId portion. The complementary invariant — that
    // the inner store never returns a colon-containing rawJobId — is now
    // enforced at delegate time so a future custom JobStoreOptions.idFactory
    // cannot regress the boundary silently.

    it('round-trips a colon-containing mindId through scope/unscope', async () => {
      const store = buildStore();
      const scoped = new MindScopedJobs(asJobStore(store), 'mind:with:colons');

      const { jobId } = await scoped.delegate({ cwd: '/repo', prompt: 'p' });
      expect(jobId.startsWith('mind:with:colons:')).toBe(true);

      // status must round-trip the same scoped jobId without throwing
      // Unknown — i.e. the unscope split must recover ('mind:with:colons',
      // 'job-1'), not ('mind', 'with:colons:job-1').
      const snap = scoped.status(jobId);
      expect(snap.jobId).toBe(jobId);
    });

    it('keeps cross-mind isolation when both mindIds contain colons', async () => {
      const store = buildStore();
      const scopedA = new MindScopedJobs(asJobStore(store), 'mind:a');
      const scopedB = new MindScopedJobs(asJobStore(store), 'mind:b');

      const { jobId: jobA } = await scopedA.delegate({ cwd: '/repo', prompt: 'p' });
      // mindB must not be able to read mindA's job by reusing the same scoped id.
      expect(() => scopedB.status(jobA)).toThrow(/Unknown job_id/);
      // …or by spoofing the prefix.
      const rawSuffix = jobA.slice('mind:a:'.length);
      expect(() => scopedB.status(`mind:b:${rawSuffix}`)).toThrow(/Unknown job_id/);
    });

    it('rejects an inner JobStore.idFactory that returns colon-containing rawJobIds', async () => {
      // A custom idFactory that produces ids carrying ':' would silently
      // shift the unscope boundary on lastIndexOf. Reject it at the
      // boundary so the failure mode is loud and immediate.
      const evilStore = {
        delegate: vi.fn(async () => ({ jobId: 'has:colon', sessionId: 'sess-1' })),
        respond: vi.fn(),
        approve: vi.fn(),
        cancel: vi.fn(async () => {}),
        status: vi.fn(),
        list: vi.fn(() => [snap('has:colon')]),
      };
      const scoped = new MindScopedJobs(asJobStore(evilStore as unknown as FakeStore), 'mind-a');

      await expect(scoped.delegate({ cwd: '/repo', prompt: 'p' })).rejects.toThrow(
        /MindScopedJobs invariant violated.*colon/i,
      );
      expect(evilStore.cancel).toHaveBeenCalledWith('has:colon');
      expect(scoped.list()).toEqual([]);
    });
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

  it('forwards permissionMode through delegate to the inner store', async () => {
    const store = buildStore();
    const scoped = new MindScopedJobs(asJobStore(store), 'mind-a');

    await scoped.delegate({ cwd: '/repo', prompt: 'safe-default' });
    await scoped.delegate({ cwd: '/repo', prompt: 'explicit-safe', permissionMode: 'safe' });
    await scoped.delegate({ cwd: '/repo', prompt: 'yolo-job', permissionMode: 'yolo' });

    // Inner store sees the exact params object the mind asked for. The
    // adapter never silently downgrades or upgrades the permission mode —
    // the mode is the property of the job, set by the mind that delegated
    // it, and audited by chamber-copilot's tool description.
    expect(store.delegate).toHaveBeenNthCalledWith(1, { cwd: '/repo', prompt: 'safe-default' });
    expect(store.delegate).toHaveBeenNthCalledWith(2, { cwd: '/repo', prompt: 'explicit-safe', permissionMode: 'safe' });
    expect(store.delegate).toHaveBeenNthCalledWith(3, { cwd: '/repo', prompt: 'yolo-job', permissionMode: 'yolo' });
  });

  it('records delegated ACP child jobs in the task ledger and finalizes them on cancel', async () => {
    const store = buildStore();
    const ledger = new TaskLedger(new InMemoryLedgerStore(), {
      createLedgerId: () => 'ledger-acp',
      now: () => '2026-05-21T21:30:00.000Z',
    });
    const scoped = new MindScopedJobs(asJobStore(store), 'mind-a', () => ledger);

    const { jobId } = await scoped.delegate({ cwd: '/repo', prompt: 'build it', permissionMode: 'yolo' });

    expect(ledger.reader.getByLedgerId('ledger-acp')).toMatchObject({
      runtime: 'acp-child',
      ownerMindId: 'mind-a',
      status: 'running',
      task: 'build it',
      sourceId: 'job-1',
      label: 'yolo',
      payload: { runtime: 'acp-child', rawJobId: 'job-1', cwd: '/repo' },
    });

    await scoped.cancel(jobId);

    expect(ledger.reader.getByLedgerId('ledger-acp')).toMatchObject({
      status: 'cancelled',
      terminalSummary: 'cancelled',
    });
  });

  it('finalizes ACP child ledger rows when status observes natural completion', async () => {
    const store = buildStore();
    store.status.mockImplementation((jobId: string) => snap(jobId, { status: 'completed' }));
    const ledger = new TaskLedger(new InMemoryLedgerStore(), {
      createLedgerId: () => 'ledger-acp',
      now: () => '2026-05-21T21:30:00.000Z',
    });
    const scoped = new MindScopedJobs(asJobStore(store), 'mind-a', () => ledger);
    const { jobId } = await scoped.delegate({ cwd: '/repo', prompt: 'build it' });

    scoped.status(jobId);

    expect(ledger.reader.getByLedgerId('ledger-acp')).toMatchObject({
      status: 'succeeded',
      terminalSummary: 'succeeded',
    });
  });

  it('finalizes ACP child ledger rows when list observes failure', async () => {
    const store = buildStore();
    const ledger = new TaskLedger(new InMemoryLedgerStore(), {
      createLedgerId: () => 'ledger-acp',
      now: () => '2026-05-21T21:30:00.000Z',
    });
    const scoped = new MindScopedJobs(asJobStore(store), 'mind-a', () => ledger);
    await scoped.delegate({ cwd: '/repo', prompt: 'build it' });
    store.list.mockReturnValue([snap('job-1', { status: 'failed' })]);

    scoped.list();

    expect(ledger.reader.getByLedgerId('ledger-acp')).toMatchObject({
      status: 'failed',
      terminalSummary: 'failed',
    });
  });

  it('forwards permissionMode through list filter to the inner store', async () => {
    const store = buildStore();
    const scoped = new MindScopedJobs(asJobStore(store), 'mind-a');
    await scoped.delegate({ cwd: '/repo', prompt: 'p' });

    scoped.list({ status: 'running', permissionMode: 'yolo' });

    expect(store.list).toHaveBeenCalledWith({ status: 'running', permissionMode: 'yolo' });
  });

  it('preserves permissionMode on status snapshots so a mind can audit its yolo jobs', async () => {
    const store = buildStore();
    // Override status to return a yolo-mode snapshot for the job we're about to create.
    store.status.mockImplementation((jobId: string) => snap(jobId, { permissionMode: 'yolo' }));
    const scoped = new MindScopedJobs(asJobStore(store), 'mind-a');
    const { jobId } = await scoped.delegate({ cwd: '/repo', prompt: 'p', permissionMode: 'yolo' });

    const status = scoped.status(jobId);

    expect(status.permissionMode).toBe('yolo');
    // The scoping rewrites jobId but leaves permissionMode intact.
    expect(status.jobId).toBe('mind-a:job-1');
  });
});
