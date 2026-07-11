import { describe, expect, it, vi } from 'vitest';

import type { Tool } from '../mind/types';
import { WtdAdvisorService } from './WtdAdvisorService';
import type { WtdRuntimeClient, WtdRuntimeRetrieveResult } from './types';

const RUNTIME_RESULT: WtdRuntimeRetrieveResult = {
  packageVersion: '0.1.0',
  revision: 'v0.4.3',
  cacheHit: true,
  queryKind: 'draftDag',
  querySummary: 'fix verify publish',
  candidates: [{
    id: 'fan-out',
    name: 'fan out synthesize',
    description: 'Parallel branches converge into synthesis.',
    score: 0.91,
    nodeCount: 5,
    edgeCount: 5,
    depth: 3,
    rankReason: 'retrieval=0.91',
    guidance: 'Use parallel branches followed by verification.',
    risks: ['Do not merge unverified branch output.'],
  }],
  fallback: {
    used: false,
    from: 'draftDagStructuralRetrieval',
    to: 'metadataFallbackRetrieval',
    reason: '',
  },
};

describe('WtdAdvisorService', () => {
  it('exposes a bounded topology authoring tool', async () => {
    const runtime = fakeRuntime();
    const service = new WtdAdvisorService(runtime);
    const [tool] = service.getToolsForMind();

    expect(tool?.name).toBe('wtd_retrieve_topology');
    const result = await getHandler(tool)({
      query: 'fix independent branches and verify',
      draftDag: {
        title: 'fix verify publish',
        steps: ['Inspect failures', 'Fix branches', 'Verify', 'Publish'],
      },
    }, TOOL_INVOCATION);

    expect(runtime.retrieve).toHaveBeenCalledWith({
      query: 'fix independent branches and verify',
      draftDag: {
        title: 'fix verify publish',
        steps: ['Inspect failures', 'Fix branches', 'Verify', 'Publish'],
      },
      k: 5,
      mode: 'auto',
    });
    expect(result).toEqual({
      packageVersion: '0.1.0',
      revision: 'v0.4.3',
      cacheHit: true,
      queryKind: 'draftDag',
      querySummary: 'fix verify publish',
      fallback: RUNTIME_RESULT.fallback,
      candidates: [{
        id: 'fan-out',
        name: 'fan out synthesize',
        score: 0.91,
        description: 'Parallel branches converge into synthesis.',
        shape: { nodes: 5, edges: 5, depth: 3 },
        rankReason: 'retrieval=0.91',
        guidance: 'Use parallel branches followed by verification.',
        risks: ['Do not merge unverified branch output.'],
      }],
    });
  });

  it('rejects empty, oversized, and unsupported requests before calling the runtime', async () => {
    const runtime = fakeRuntime();
    const [tool] = new WtdAdvisorService(runtime).getToolsForMind();
    const handler = getHandler(tool);

    await expect(handler({}, TOOL_INVOCATION)).rejects.toThrow('requires query text');
    await expect(handler({ query: 'x'.repeat(4_001) }, TOOL_INVOCATION)).rejects.toThrow('must not exceed 4000');
    await expect(handler({ draftDag: { steps: [] } }, TOOL_INVOCATION)).rejects.toThrow('between 1 and 64');
    await expect(handler({ query: 'plan', k: 6 }, TOOL_INVOCATION)).rejects.toThrow('integer from 1 to 5');
    await expect(handler({ query: 'plan', mode: 'magic' }, TOOL_INVOCATION)).rejects.toThrow('auto, structural, or metadata');
    expect(runtime.retrieve).not.toHaveBeenCalled();
  });

  it('stops the shared runtime process', async () => {
    const runtime = fakeRuntime();
    const service = new WtdAdvisorService(runtime);

    await service.stop();

    expect(runtime.stop).toHaveBeenCalledOnce();
  });
});

const TOOL_INVOCATION = {
  sessionId: 'session-1',
  toolCallId: 'tool-call-1',
  toolName: 'wtd_retrieve_topology',
  arguments: {},
};

function getHandler(tool: Tool | undefined): NonNullable<Tool['handler']> {
  if (!tool?.handler) throw new Error('Expected WTD tool handler');
  return tool.handler;
}

function fakeRuntime(): WtdRuntimeClient & {
  retrieve: ReturnType<typeof vi.fn<WtdRuntimeClient['retrieve']>>;
  stop: ReturnType<typeof vi.fn<WtdRuntimeClient['stop']>>;
} {
  return {
    retrieve: vi.fn<WtdRuntimeClient['retrieve']>().mockResolvedValue(RUNTIME_RESULT),
    stop: vi.fn<WtdRuntimeClient['stop']>().mockResolvedValue(undefined),
  };
}
