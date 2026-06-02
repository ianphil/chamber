/**
 * Phase 8 — FakeLLMClient sanity tests.
 *
 * Phase 9 (DreamDaemon) wires its orchestrator tests against this fake;
 * keeping a small smoke around the helper itself prevents drift in the
 * canned-response semantics from silently skewing daemon tests later.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFakeLLMClient } from './FakeLLMClient';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createFakeLLMClient', () => {
  it('records each synthesize call', async () => {
    const client = createFakeLLMClient();
    await client.synthesize({ prompt: 'a', timeoutMs: 1_000 });
    await client.synthesize({ prompt: 'b', timeoutMs: 2_000, maxTokens: 32 });
    expect(client.calls.map((c) => c.prompt)).toEqual(['a', 'b']);
    expect(client.calls[1].maxTokens).toBe(32);
  });

  it('returns the longest matching prefix response', async () => {
    const client = createFakeLLMClient({
      responses: { 'memory:': 'short', 'memory:weekly:': 'long' },
      defaultResponse: 'fallback',
    });
    expect(await client.synthesize({ prompt: 'memory:weekly:foo', timeoutMs: 1_000 })).toBe('long');
    expect(await client.synthesize({ prompt: 'memory:daily:foo', timeoutMs: 1_000 })).toBe('short');
    expect(await client.synthesize({ prompt: 'other', timeoutMs: 1_000 })).toBe('fallback');
  });

  it('throws the configured error verbatim', async () => {
    const client = createFakeLLMClient({ error: new Error('nope') });
    await expect(client.synthesize({ prompt: 'p', timeoutMs: 1_000 })).rejects.toThrow('nope');
  });

  it('rejects with the canonical timeout message when latency exceeds timeoutMs', async () => {
    const client = createFakeLLMClient({ latencyMs: 5_000 });
    const settled = client.synthesize({ prompt: 'p', timeoutMs: 250 })
      .catch((e: unknown) => e as Error);
    await vi.advanceTimersByTimeAsync(250);
    const err = await settled;
    expect((err as Error).message).toBe('LLM synthesis timed out after 250ms');
  });
});
