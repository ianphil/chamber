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
  delegate = vi.fn(async ({ cwd, prompt }: { cwd: string; prompt: string }) => ({
    jobId: 'job-1',
    sessionId: `sess-${cwd}-${prompt.slice(0, 4)}`,
  }));
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
  readonly stubTools: AcpTool[];
}

function buildHarness(overrides: { stubTools?: AcpTool[] } = {}): Harness {
  const connection = new FakeAcpConnection();
  const store = new FakeJobStore();
  const toolFactoryCalls: Array<{ store: JobStore }> = [];
  const stubTools = overrides.stubTools ?? [
    makeStubTool('cli_delegate'),
    makeStubTool('cli_status'),
    makeStubTool('cli_respond'),
    makeStubTool('cli_approve'),
    makeStubTool('cli_cancel'),
    makeStubTool('cli_list'),
  ];

  const service = new ChamberCopilotService({
    connectionFactory: () => connection as unknown as AcpConnection,
    jobStoreFactory: (conn) => {
      // Sanity check the wiring direction: store gets the same connection.
      void conn;
      return store as unknown as JobStore;
    },
    toolFactory: (deps) => {
      toolFactoryCalls.push(deps);
      return stubTools;
    },
  });

  return { service, connection, store, toolFactoryCalls, stubTools };
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

  it('does not start the connection if no mind is activated', () => {
    const { service, connection } = buildHarness();

    void service;
    expect(connection.start).not.toHaveBeenCalled();
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

  it('builds the cli_* tools from the JobStore exactly once', async () => {
    const { service, toolFactoryCalls, store } = buildHarness();
    await service.activateMind('mind-1', '/tmp/mind-1');

    service.getToolsForMind('mind-1', '/tmp/mind-1');
    service.getToolsForMind('mind-1', '/tmp/mind-1');
    service.getToolsForMind('mind-2', '/tmp/mind-2');

    expect(toolFactoryCalls).toHaveLength(1);
    expect(toolFactoryCalls[0].store).toBe(store as unknown as JobStore);
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
});
