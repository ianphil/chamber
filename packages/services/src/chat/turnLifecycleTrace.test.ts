import { describe, it, expect } from 'vitest';
import { TurnLifecycleTrace } from './turnLifecycleTrace';

describe('TurnLifecycleTrace', () => {
  it('records each event with type, timestamp, and computed outstanding-tool count', () => {
    const trace = new TurnLifecycleTrace();
    trace.record({ type: 'tool.execution_start', data: { toolCallId: 't1' } });
    trace.record({ type: 'tool.execution_start', data: { toolCallId: 't2' } });
    trace.record({ type: 'tool.execution_complete', data: { toolCallId: 't1' } });

    const summary = trace.summary('completed');
    expect(summary.entries).toHaveLength(3);
    expect(summary.entries.map((e) => e.outstandingToolCount)).toEqual([1, 2, 1]);
    expect(summary.outstandingToolCount).toBe(1);
  });

  it('carries optional agentId and toolCallId through to entries', () => {
    const trace = new TurnLifecycleTrace();
    trace.record({ type: 'assistant.turn_end', agentId: 'sub-agent-1' });
    trace.record({ type: 'tool.execution_start', data: { toolCallId: 't-99' } });

    const [turnEnd, toolStart] = trace.summary('completed').entries;
    expect(turnEnd).toMatchObject({ type: 'assistant.turn_end', agentId: 'sub-agent-1' });
    expect(turnEnd.toolCallId).toBeUndefined();
    expect(toolStart).toMatchObject({ type: 'tool.execution_start', toolCallId: 't-99' });
    expect(toolStart.agentId).toBeUndefined();
  });

  it('summary.sawIdle / sawTurnEnd / sawRootTurnEnd reflect whether those events appeared', () => {
    const trace = new TurnLifecycleTrace();
    trace.record({ type: 'assistant.message' });
    trace.record({ type: 'assistant.turn_end', agentId: 'sub-1' });
    let summary = trace.summary('aborted');
    expect(summary.sawIdle).toBe(false);
    expect(summary.sawTurnEnd).toBe(true);
    // Sub-agent turn_end does NOT flip the root-only flag.
    expect(summary.sawRootTurnEnd).toBe(false);

    trace.record({ type: 'assistant.turn_end' });
    summary = trace.summary('aborted');
    expect(summary.sawRootTurnEnd).toBe(true);

    trace.record({ type: 'session.idle' });
    summary = trace.summary('completed');
    expect(summary.sawIdle).toBe(true);
    expect(summary.sawTurnEnd).toBe(true);
    expect(summary.sawRootTurnEnd).toBe(true);
  });

  it('caps stored entries at MAX_ENTRIES, keeping the most recent', () => {
    const trace = new TurnLifecycleTrace();
    for (let i = 0; i < 60; i += 1) {
      trace.record({ type: `assistant.message_delta`, data: { toolCallId: undefined } });
    }
    const summary = trace.summary('completed');
    // We don't assert the exact cap value; we assert truncation occurred and counters reflect totals.
    expect(summary.entries.length).toBeLessThan(60);
    expect(summary.eventCount).toBe(60);
  });

  it('summary.durationMs covers the span from first to last recorded event', async () => {
    const trace = new TurnLifecycleTrace();
    trace.record({ type: 'assistant.message' });
    await new Promise((r) => setTimeout(r, 5));
    trace.record({ type: 'session.idle' });

    const summary = trace.summary('completed');
    expect(summary.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('summary.reason reflects the caller-provided terminal reason', () => {
    const trace = new TurnLifecycleTrace();
    trace.record({ type: 'assistant.message' });
    expect(trace.summary('aborted').reason).toBe('aborted');
    expect(trace.summary('completed').reason).toBe('completed');
  });

  it('ignores tool.execution_complete for an unknown toolCallId (no negative counts)', () => {
    const trace = new TurnLifecycleTrace();
    trace.record({ type: 'tool.execution_complete', data: { toolCallId: 'never-started' } });
    const summary = trace.summary('completed');
    expect(summary.outstandingToolCount).toBe(0);
    expect(summary.entries[0].outstandingToolCount).toBe(0);
  });

  it('ring buffer keeps the MOST RECENT entries when capped (last-wins, not first-wins)', () => {
    const trace = new TurnLifecycleTrace();
    for (let i = 0; i < TurnLifecycleTrace.MAX_ENTRIES + 10; i += 1) {
      trace.record({ type: `evt-${i}` });
    }
    const summary = trace.summary('completed');
    expect(summary.entries).toHaveLength(TurnLifecycleTrace.MAX_ENTRIES);
    // Last entry must be the last event we recorded — guards against a
    // buggy ".pop()-style" eviction that would keep the FIRST N entries.
    const lastIdx = TurnLifecycleTrace.MAX_ENTRIES + 10 - 1;
    expect(summary.entries[summary.entries.length - 1].type).toBe(`evt-${lastIdx}`);
    // And the oldest retained entry is the first one within the kept window.
    expect(summary.entries[0].type).toBe(`evt-${lastIdx - TurnLifecycleTrace.MAX_ENTRIES + 1}`);
  });
});
