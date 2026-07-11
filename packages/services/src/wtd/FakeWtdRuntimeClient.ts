import type {
  WtdRetrieveRequest,
  WtdRuntimeClient,
  WtdRuntimeRetrieveResult,
} from './types';

export class FakeWtdRuntimeClient implements WtdRuntimeClient {
  async retrieve(request: WtdRetrieveRequest): Promise<WtdRuntimeRetrieveResult> {
    return {
      packageVersion: '0.1.0',
      revision: 'v0.4.3',
      cacheHit: true,
      queryKind: request.draftDag ? 'draftDag' : 'text',
      querySummary: request.draftDag?.title ?? request.query ?? 'create greeting workflow',
      candidates: [{
        id: 'linear-chain-v1',
        name: 'Linear Chain',
        description: 'Sequential two-step workflow: task A then task B.',
        score: 0.99,
        nodeCount: 2,
        edgeCount: 1,
        depth: 2,
        rankReason: 'Deterministic fake for Chamber desktop smoke coverage.',
        guidance:
          'Build a TaskGraph with task "hello" that prints a greeting, '
          + 'then task "goodbye" that depends on "hello".',
      }],
    };
  }

  async stop(): Promise<void> {}
}
