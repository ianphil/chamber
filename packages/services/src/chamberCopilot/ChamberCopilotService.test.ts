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
    permissionMode: 'safe',
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

interface DualModeHarness {
  readonly service: ChamberCopilotService;
  readonly safeConnection: FakeAcpConnection;
  readonly yoloConnection: FakeAcpConnection;
  readonly safeFactory: ReturnType<typeof vi.fn>;
  readonly yoloFactory: ReturnType<typeof vi.fn>;
  readonly jobStoreFactoryCalls: Array<{ readonly safe: AcpConnection; readonly yolo?: AcpConnection }>;
}

function buildDualModeHarness(overrides: {
  yoloConnection?: FakeAcpConnection;
  yoloFactory?: () => AcpConnection;
} = {}): DualModeHarness {
  const safeConnection = new FakeAcpConnection();
  const yoloConnection = overrides.yoloConnection ?? new FakeAcpConnection();
  const safeFactory = vi.fn(() => safeConnection as unknown as AcpConnection);
  const yoloFactory = vi.fn(overrides.yoloFactory ?? (() => yoloConnection as unknown as AcpConnection));
  const store = new FakeJobStore();
  const jobStoreFactoryCalls: Array<{ readonly safe: AcpConnection; readonly yolo?: AcpConnection }> = [];

  const service = new ChamberCopilotService({
    connectionsByMode: { safe: safeFactory, yolo: yoloFactory },
    jobStoreFactory: (connections) => {
      jobStoreFactoryCalls.push(connections);
      return store as unknown as JobStore;
    },
    toolFactory: () => [],
  });

  return { service, safeConnection, yoloConnection, safeFactory, yoloFactory, jobStoreFactoryCalls };
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

  it('prewarm starts the connection eagerly so the first getToolsForMind sees the cli_* tools', async () => {
    const { service, connection } = buildHarness();

    // Before prewarm: store is null, getToolsForMind returns [].
    expect(service.getToolsForMind('mind-1', '/tmp/mind-1')).toEqual([]);

    await service.prewarm();

    expect(connection.start).toHaveBeenCalledOnce();

    // After prewarm: getToolsForMind for ANY mind builds the per-mind
    // scoped tool surface, even without a prior activateMind. This is
    // the production-relevant behavior: MindManager.doLoadMind calls
    // getSessionTools BEFORE activateProviders, so the cli_* tools must
    // be available to that first call.
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

  it('prewarm swallows connection-start failures and leaves the service in a valid degraded state', async () => {
    const failingConnection = new FakeAcpConnection();
    failingConnection.start = vi.fn(async () => {
      throw new Error('cli not found');
    });

    const { service } = buildHarness({
      connectionFactory: () => failingConnection as unknown as AcpConnection,
    });

    // prewarm must not throw — composition root awaits it during app boot,
    // and a failure must not take down the entire app.
    await expect(service.prewarm()).resolves.toBeUndefined();

    expect(failingConnection.start).toHaveBeenCalledOnce();
    expect(service.getToolsForMind('mind-1', '/tmp/mind-1')).toEqual([]);
  });

  it('activateMind degrades gracefully when connection start fails so the mind still loads with empty tools', async () => {
    const failingConnection = new FakeAcpConnection();
    failingConnection.start = vi.fn(async () => {
      throw new Error('cli spawn failed');
    });

    const { service } = buildHarness({
      connectionFactory: () => failingConnection as unknown as AcpConnection,
    });

    // activateMind must NOT throw — MindManager.doLoadMind catches
    // activate failures and aborts the entire mind load otherwise.
    await expect(service.activateMind('mind-1', '/tmp/mind-1')).resolves.toBeUndefined();

    expect(failingConnection.start).toHaveBeenCalledOnce();
    expect(service.getToolsForMind('mind-1', '/tmp/mind-1')).toEqual([]);

    // Releasing a mind that never made it past failed activate must be a
    // safe no-op (the mind was never tracked in activeMinds).
    await expect(service.releaseMind('mind-1')).resolves.toBeUndefined();
    expect(failingConnection.stop).not.toHaveBeenCalled();
  });

  it('resetAuthState keeps a fresh prewarmed store available through a mind reload', async () => {
    const { service, connection } = buildHarness();

    await service.activateMind('mind-1', '/tmp/mind-1');
    await service.resetAuthState();
    await service.releaseMind('mind-1');

    expect(connection.stop).toHaveBeenCalledOnce();
    expect(service.getToolsForMind('mind-2', '/tmp/mind-2').map((tool) => tool.name)).toContain('cli_delegate');

    await service.activateMind('mind-2', '/tmp/mind-2');
    await service.releaseMind('mind-2');

    expect(connection.stop).toHaveBeenCalledTimes(2);
  });

  it('resetAuthState invalidates an in-flight prewarm so stale auth cannot win the race', async () => {
    const staleConnection = new FakeAcpConnection();
    let resolveStaleStart: (() => void) | undefined;
    staleConnection.start = vi.fn(() => new Promise<void>((resolve) => {
      resolveStaleStart = () => {
        staleConnection.isStarted = true;
        resolve();
      };
    }));
    const freshConnection = new FakeAcpConnection();
    const connectionFactory = vi.fn()
      .mockReturnValueOnce(staleConnection as unknown as AcpConnection)
      .mockReturnValueOnce(freshConnection as unknown as AcpConnection);
    const service = new ChamberCopilotService({
      connectionFactory,
      jobStoreFactory: () => new FakeJobStore() as unknown as JobStore,
      toolFactory: () => [makeStubTool('cli_delegate')],
    });

    const prewarm = service.prewarm();
    await Promise.resolve();
    const reset = service.resetAuthState();
    await Promise.resolve();
    resolveStaleStart?.();

    await Promise.all([prewarm, reset]);

    expect(staleConnection.stop).toHaveBeenCalledOnce();
    expect(freshConnection.start).toHaveBeenCalledOnce();
    expect(service.getToolsForMind('mind-1', '/tmp/mind-1').map((tool) => tool.name)).toEqual(['cli_delegate']);
  });

  describe('connectionsByMode (yolo posture)', () => {
    it('rejects passing both connectionFactory and connectionsByMode at the same time', () => {
      const safe = vi.fn(() => new FakeAcpConnection() as unknown as AcpConnection);
      expect(
        () => new ChamberCopilotService({
          connectionFactory: safe,
          connectionsByMode: { safe },
          jobStoreFactory: () => new FakeJobStore() as unknown as JobStore,
          toolFactory: () => [],
        }),
      ).toThrow(/either `connectionFactory`.*or `connectionsByMode`/);
    });

    it('rejects connectionsByMode with a non-function safe factory', () => {
      expect(
        () => new ChamberCopilotService({
          connectionsByMode: { safe: undefined as unknown as () => AcpConnection },
          jobStoreFactory: () => new FakeJobStore() as unknown as JobStore,
          toolFactory: () => [],
        }),
      ).toThrow(/connectionsByMode\.safe/);
    });

    it('starts both safe and yolo connections eagerly on prewarm and passes both to the JobStore factory', async () => {
      const { service, safeConnection, yoloConnection, safeFactory, yoloFactory, jobStoreFactoryCalls } =
        buildDualModeHarness();

      await service.prewarm();

      expect(safeFactory).toHaveBeenCalledOnce();
      expect(yoloFactory).toHaveBeenCalledOnce();
      expect(safeConnection.start).toHaveBeenCalledOnce();
      expect(yoloConnection.start).toHaveBeenCalledOnce();

      // The JobStore factory receives BOTH connections so chamber-copilot
      // can route delegate({ permissionMode: 'yolo' }) to the yolo child.
      expect(jobStoreFactoryCalls).toHaveLength(1);
      expect(jobStoreFactoryCalls[0].safe).toBe(safeConnection as unknown as AcpConnection);
      expect(jobStoreFactoryCalls[0].yolo).toBe(yoloConnection as unknown as AcpConnection);
    });

    it('stops both safe and yolo connections when the last mind is released', async () => {
      const { service, safeConnection, yoloConnection } = buildDualModeHarness();

      await service.activateMind('mind-1', '/tmp/mind-1');
      await service.releaseMind('mind-1');

      expect(safeConnection.stop).toHaveBeenCalledOnce();
      expect(yoloConnection.stop).toHaveBeenCalledOnce();
    });

    it('runs safe-only when the yolo factory throws synchronously', async () => {
      const { service, safeConnection, yoloConnection, jobStoreFactoryCalls } = buildDualModeHarness({
        yoloFactory: () => {
          throw new Error('--yolo unsupported by bundled CLI');
        },
      });

      // prewarm must NOT throw — yolo failure is best-effort.
      await expect(service.prewarm()).resolves.toBeUndefined();

      expect(safeConnection.start).toHaveBeenCalledOnce();
      // The JobStore factory receives only `safe` — `yolo` is omitted, so
      // chamber-copilot will surface UnsupportedPermissionModeError for
      // any cli_delegate({ permission_mode: 'yolo' }).
      expect(jobStoreFactoryCalls).toHaveLength(1);
      expect(jobStoreFactoryCalls[0].safe).toBe(safeConnection as unknown as AcpConnection);
      expect(jobStoreFactoryCalls[0].yolo).toBeUndefined();
      expect(yoloConnection.start).not.toHaveBeenCalled();
    });

    it('runs safe-only when the yolo connection.start() rejects', async () => {
      const failingYolo = new FakeAcpConnection();
      failingYolo.start = vi.fn(async () => {
        throw new Error('yolo child spawn failed');
      });
      const { service, safeConnection, jobStoreFactoryCalls } = buildDualModeHarness({
        yoloConnection: failingYolo,
      });

      await expect(service.prewarm()).resolves.toBeUndefined();

      expect(safeConnection.start).toHaveBeenCalledOnce();
      expect(failingYolo.start).toHaveBeenCalledOnce();
      // Safe-only fallback: JobStore receives only `safe`.
      expect(jobStoreFactoryCalls[0].yolo).toBeUndefined();
    });

    it('does not let an old yolo-start failure assign stale safe-only connections after reset', async () => {
      const staleSafe = new FakeAcpConnection();
      const staleYolo = new FakeAcpConnection();
      let rejectStaleYolo: ((error: Error) => void) | undefined;
      staleYolo.start = vi.fn(() => new Promise<void>((_resolve, reject) => {
        rejectStaleYolo = reject;
      }));
      const freshSafe = new FakeAcpConnection();
      const freshYolo = new FakeAcpConnection();
      const safeFactory = vi.fn()
        .mockReturnValueOnce(staleSafe as unknown as AcpConnection)
        .mockReturnValueOnce(freshSafe as unknown as AcpConnection);
      const yoloFactory = vi.fn()
        .mockReturnValueOnce(staleYolo as unknown as AcpConnection)
        .mockReturnValueOnce(freshYolo as unknown as AcpConnection);
      const jobStoreFactoryCalls: Array<{ readonly safe: AcpConnection; readonly yolo?: AcpConnection }> = [];
      const service = new ChamberCopilotService({
        connectionsByMode: { safe: safeFactory, yolo: yoloFactory },
        jobStoreFactory: (connections) => {
          jobStoreFactoryCalls.push(connections);
          return new FakeJobStore() as unknown as JobStore;
        },
        toolFactory: () => [],
      });

      const prewarm = service.prewarm();
      await Promise.resolve();
      const reset = service.resetAuthState();
      await Promise.resolve();
      rejectStaleYolo?.(new Error('old yolo failed after auth reset'));

      await Promise.all([prewarm, reset]);

      expect(staleSafe.stop).toHaveBeenCalledOnce();
      expect(freshSafe.start).toHaveBeenCalledOnce();
      expect(freshYolo.start).toHaveBeenCalledOnce();
      expect(jobStoreFactoryCalls).toHaveLength(1);
      expect(jobStoreFactoryCalls[0].safe).toBe(freshSafe as unknown as AcpConnection);
      expect(jobStoreFactoryCalls[0].yolo).toBe(freshYolo as unknown as AcpConnection);
    });

    it('treats a safe-start failure as fatal (no yolo factory call attempted)', async () => {
      const failingSafe = new FakeAcpConnection();
      failingSafe.start = vi.fn(async () => {
        throw new Error('safe child spawn failed');
      });
      const yoloFactory = vi.fn(() => new FakeAcpConnection() as unknown as AcpConnection);

      const service = new ChamberCopilotService({
        connectionsByMode: {
          safe: () => failingSafe as unknown as AcpConnection,
          yolo: yoloFactory,
        },
        jobStoreFactory: () => new FakeJobStore() as unknown as JobStore,
        toolFactory: () => [],
      });

      // prewarm swallows the error (degraded mode), but yolo must never be
      // attempted: without safe, chamber-copilot's JobStore would throw
      // anyway, and we don't want to leak a yolo child that has no JobStore
      // owner.
      await expect(service.prewarm()).resolves.toBeUndefined();
      expect(failingSafe.start).toHaveBeenCalledOnce();
      expect(yoloFactory).not.toHaveBeenCalled();
    });
  });
});
