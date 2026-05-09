import { describe, it, expect, vi } from 'vitest';
import type {
  AcpConnection,
  AcpTool,
  JobSnapshot,
  JobStore,
} from 'chamber-copilot';
import { ChamberCopilotService } from './ChamberCopilotService';

class FakeAcpConnection {
  isStarted = false;
  start = vi.fn(async () => {
    if (this.isStarted) throw new Error('already started');
    this.isStarted = true;
  });
  stop = vi.fn(async () => {
    this.isStarted = false;
  });
  newSession = vi.fn(async () => ({ sessionId: 'fake-session' }));
  prompt = vi.fn(async () => ({ stopReason: 'end_turn' }));
  cancel = vi.fn(async () => {});
  onSessionUpdate = vi.fn(() => () => {});
  setPermissionHandler = vi.fn();
  setRequestHandler = vi.fn();
  protocolVersion: number | null = 1;
}

class FakeJobStore {
  // The fake records every job the service has delegated to it so the
  // release-cancels-jobs assertion can target the right ids without
  // hard-coding internals.
  readonly delegatedJobIds: string[] = [];
  private counter = 0;

  delegate = vi.fn(async ({ cwd, prompt }: { cwd: string; prompt: string }) => {
    this.counter += 1;
    const jobId = `job-${this.counter}`;
    this.delegatedJobIds.push(jobId);
    return { jobId, sessionId: `sess-${cwd}-${prompt.slice(0, 4)}` };
  });
  respond = vi.fn(async () => {});
  approve = vi.fn(async () => {});
  cancel = vi.fn(async () => {});
  status = vi.fn((jobId: string): JobSnapshot => ({
    jobId,
    cwd: '/tmp',
    sessionId: 'fake',
    status: 'idle',
    eventLog: [],
    pendingApproval: null,
    createdAt: 0,
    lastUpdateAt: 0,
    lastStopReason: 'end_turn',
  }));
  list = vi.fn((): JobSnapshot[] => []);
}

interface Harness {
  readonly service: ChamberCopilotService;
  readonly connection: FakeAcpConnection;
  readonly store: FakeJobStore;
  readonly toolFactoryCalls: Array<{ store: JobStore }>;
  readonly stubToolNames: readonly string[];
}

function buildHarness(overrides: { connectionFactory?: () => AcpConnection } = {}): Harness {
  const connection = new FakeAcpConnection();
  const store = new FakeJobStore();
  const toolFactoryCalls: Array<{ store: JobStore }> = [];
  const stubToolNames = [
    'cli_delegate',
    'cli_status',
    'cli_respond',
    'cli_approve',
    'cli_cancel',
    'cli_list',
  ] as const;

  const service = new ChamberCopilotService({
    connectionFactory: overrides.connectionFactory ?? (() => connection as unknown as AcpConnection),
    jobStoreFactory: () => store as unknown as JobStore,
    toolFactory: (deps) => {
      toolFactoryCalls.push(deps);
      return stubToolNames.map((name) => makeStubTool(name));
    },
  });

  return { service, connection, store, toolFactoryCalls, stubToolNames };
}

function makeStubTool(name: string): AcpTool {
  return {
    name,
    description: `${name} stub`,
    parameters: { type: 'object', properties: {} },
    handler: vi.fn(async () => '{}'),
  };
}

describe('ChamberCopilotService', () => {
  it('lazy-starts the AcpConnection on first activateMind', async () => {
    const { service, connection } = buildHarness();

    expect(connection.start).not.toHaveBeenCalled();

    await service.activateMind('mind-1', '/tmp/mind-1');

    expect(connection.start).toHaveBeenCalledOnce();
  });

  it('reuses a single connection across multiple minds', async () => {
    const { service, connection } = buildHarness();

    await service.activateMind('mind-1', '/tmp/mind-1');
    await service.activateMind('mind-2', '/tmp/mind-2');
    await service.activateMind('mind-3', '/tmp/mind-3');

    expect(connection.start).toHaveBeenCalledOnce();
  });

  it('serializes concurrent first-activates so the connection starts exactly once', async () => {
    const { service, connection } = buildHarness();

    await Promise.all([
      service.activateMind('mind-a', '/tmp/a'),
      service.activateMind('mind-b', '/tmp/b'),
      service.activateMind('mind-c', '/tmp/c'),
    ]);

    expect(connection.start).toHaveBeenCalledOnce();
  });

  it('stops the connection when the last activated mind is released', async () => {
    const { service, connection } = buildHarness();

    await service.activateMind('mind-1', '/tmp/mind-1');
    await service.activateMind('mind-2', '/tmp/mind-2');
    await service.releaseMind('mind-1');

    expect(connection.stop).not.toHaveBeenCalled();

    await service.releaseMind('mind-2');

    expect(connection.stop).toHaveBeenCalledOnce();
  });

  it('releaseMind for an unknown mind is a no-op', async () => {
    const { service, connection } = buildHarness();

    await service.releaseMind('never-activated');

    expect(connection.stop).not.toHaveBeenCalled();
  });

  it('restarts the connection if a mind is activated again after full shutdown', async () => {
    const { service, connection } = buildHarness();

    await service.activateMind('mind-1', '/tmp/mind-1');
    await service.releaseMind('mind-1');
    await service.activateMind('mind-1', '/tmp/mind-1');

    expect(connection.start).toHaveBeenCalledTimes(2);
  });

  it('getToolsForMind returns the canvas-shape cli_* tools', async () => {
    const { service } = buildHarness();
    await service.activateMind('mind-1', '/tmp/mind-1');

    const tools = service.getToolsForMind('mind-1', '/tmp/mind-1');

    expect(tools.map((tool) => tool.name)).toEqual([
      'cli_delegate',
      'cli_status',
      'cli_respond',
      'cli_approve',
      'cli_cancel',
      'cli_list',
    ]);
  });

  it('builds a separate cli_* tool surface per mind so trust boundaries are not shared', async () => {
    const { service, toolFactoryCalls } = buildHarness();
    await service.activateMind('mind-1', '/tmp/mind-1');
    await service.activateMind('mind-2', '/tmp/mind-2');

    service.getToolsForMind('mind-1', '/tmp/mind-1');
    service.getToolsForMind('mind-1', '/tmp/mind-1'); // cached
    service.getToolsForMind('mind-2', '/tmp/mind-2');

    // Two distinct minds → two distinct tool factory calls. The store passed
    // to each call is the per-mind MindScopedJobs adapter (not the bare
    // shared JobStore), so cross-mind cli_status/respond/approve/cancel/list
    // is impossible — see MindScopedJobs.test.ts for that contract.
    expect(toolFactoryCalls).toHaveLength(2);
    expect(toolFactoryCalls[0].store).not.toBe(toolFactoryCalls[1].store);
  });

  it('returns an empty tool list before any mind has activated', () => {
    const { service } = buildHarness();

    expect(service.getToolsForMind('mind-1', '/tmp/mind-1')).toEqual([]);
  });

  it('idempotent stop — releasing twice does not call stop twice', async () => {
    const { service, connection } = buildHarness();

    await service.activateMind('mind-1', '/tmp/mind-1');
    await service.releaseMind('mind-1');
    await service.releaseMind('mind-1');

    expect(connection.stop).toHaveBeenCalledOnce();
  });

  it('cancels every job owned by a mind when the mind is released', async () => {
    const { service, store, toolFactoryCalls } = buildHarness();
    await service.activateMind('mind-1', '/tmp/mind-1');
    service.getToolsForMind('mind-1', '/tmp/mind-1'); // triggers tool factory call
    const scopedStore = toolFactoryCalls[0].store; // the MindScopedJobs adapter

    await scopedStore.delegate({ cwd: '/repo', prompt: 'p1' });
    await scopedStore.delegate({ cwd: '/repo', prompt: 'p2' });

    expect(store.delegatedJobIds).toEqual(['job-1', 'job-2']);

    await service.releaseMind('mind-1');

    expect(store.cancel).toHaveBeenCalledWith('job-1');
    expect(store.cancel).toHaveBeenCalledWith('job-2');
  });

  it('release with slow shutdown does not block a fresh activate from starting a new connection', async () => {
    const connections: FakeAcpConnection[] = [];
    let stopGate: (() => void) | null = null;
    const stopBlocked = new Promise<void>((resolve) => {
      stopGate = resolve;
    });

    const { service } = buildHarness({
      connectionFactory: () => {
        const conn = new FakeAcpConnection();
        // First connection's stop() blocks until we open the gate, modeling
        // a slow teardown racing a fresh activate.
        if (connections.length === 0) {
          conn.stop = vi.fn(async () => {
            await stopBlocked;
          });
        }
        connections.push(conn);
        return conn as unknown as AcpConnection;
      },
    });

    await service.activateMind('mind-1', '/tmp/mind-1');

    // Start the release. Its body runs sync up to `await scoped.releaseAll()`
    // (which resolves immediately for a mind with no delegated jobs); on the
    // next microtask spin, shutdown() runs and synchronously nulls
    // this.connection / this.store before suspending on the gated stop().
    const releasePromise = service.releaseMind('mind-1');

    // Drain the microtask queue so shutdown's synchronous prefix has
    // executed (this.connection = null) before the parallel activate runs.
    // Without this, ensureStarted would see the old connection still alive
    // and silently reuse it — and the race wouldn't happen at all.
    await Promise.resolve();
    await Promise.resolve();

    await service.activateMind('mind-2', '/tmp/mind-2');

    expect(connections).toHaveLength(2);
    expect(connections[1].start).toHaveBeenCalledOnce();

    stopGate!();
    await releasePromise;

    // The slow stop eventually completed; the new connection is still alive.
    expect(connections[0].stop).toHaveBeenCalledOnce();
    expect(connections[1].stop).not.toHaveBeenCalled();
  });
});
