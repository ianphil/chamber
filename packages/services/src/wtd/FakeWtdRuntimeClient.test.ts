import { describe, expect, it } from 'vitest';

import { FakeWtdRuntimeClient } from './FakeWtdRuntimeClient';

describe('FakeWtdRuntimeClient', () => {
  it('returns the pinned deterministic linear topology', async () => {
    const runtime = new FakeWtdRuntimeClient();

    const result = await runtime.retrieve({
      draftDag: {
        title: 'greeting workflow',
        steps: ['Say hello', 'Say goodbye'],
      },
      k: 5,
      mode: 'auto',
    });

    expect(result.revision).toBe('v0.4.3');
    expect(result.queryKind).toBe('draftDag');
    expect(result.candidates[0]).toEqual(expect.objectContaining({
      id: 'linear-chain-v1',
      nodeCount: 2,
      edgeCount: 1,
    }));
  });
});
