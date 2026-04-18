import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock node:crypto
const mockRandomUUID = vi.fn(() => 'obs-uuid');
vi.mock('node:crypto', () => ({
  randomUUID: (...args: unknown[]) => mockRandomUUID(...args),
}));

import { ObservabilityEmitter, redactParameters } from './observability';
import type { ObservabilityEvent } from './observability';

let uuidCounter = 0;
function resetUUIDs() {
  uuidCounter = 0;
  mockRandomUUID.mockImplementation(() => `obs-${++uuidCounter}`);
}

describe('ObservabilityEmitter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetUUIDs();
  });

  it('emits structured events with correlationId', () => {
    const emitter = new ObservabilityEmitter('handoff');
    const events: ObservabilityEvent[] = [];
    emitter.on((e) => events.push(e));

    emitter.start({ participantCount: 3 });

    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('orchestration_start');
    expect(events[0].correlationId).toBe('obs-1');
    expect(events[0].orchestrationMode).toBe('handoff');
    expect(events[0].data.participantCount).toBe(3);
  });

  it('emits start and end events', () => {
    const emitter = new ObservabilityEmitter('sequential');
    const events: ObservabilityEvent[] = [];
    emitter.on((e) => events.push(e));

    emitter.start();
    emitter.end({ terminationReason: 'DONE' });

    const kinds = events.map((e) => e.kind);
    expect(kinds).toEqual(['orchestration_start', 'orchestration_end']);
  });

  it('emits agent step events', () => {
    const emitter = new ObservabilityEmitter('magentic');
    const events: ObservabilityEvent[] = [];
    emitter.on((e) => events.push(e));

    emitter.agentStep('mind-1', { hop: 0 });

    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('per_agent_step');
    expect(events[0].data.mindId).toBe('mind-1');
  });

  it('emits tool call events with redacted parameters', () => {
    const emitter = new ObservabilityEmitter('handoff');
    const events: ObservabilityEvent[] = [];
    emitter.on((e) => events.push(e));

    emitter.toolCallAttempted('mind-1', 'send_email', {
      to: 'user@example.com',
      password: 'secret',
    });

    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('tool_call_attempted');
    const params = events[0].data.parameters as Record<string, unknown>;
    expect(params.to).toBe('user@example.com');
    expect(params.password).toBe('[REDACTED]');
  });

  it('supports listener removal', () => {
    const emitter = new ObservabilityEmitter('concurrent');
    const events: ObservabilityEvent[] = [];
    const unsub = emitter.on((e) => events.push(e));

    emitter.start();
    unsub();
    emitter.end();

    expect(events).toHaveLength(1); // Only start, not end
  });

  it('listener errors do not break emission', () => {
    const emitter = new ObservabilityEmitter('concurrent');
    const events: ObservabilityEvent[] = [];

    emitter.on(() => {
      throw new Error('listener exploded');
    });
    emitter.on((e) => events.push(e));

    emitter.start();

    // Second listener should still receive the event
    expect(events).toHaveLength(1);
  });

  it('uses provided correlationId', () => {
    const emitter = new ObservabilityEmitter('handoff', 'custom-id');
    const events: ObservabilityEvent[] = [];
    emitter.on((e) => events.push(e));

    emitter.start();

    expect(events[0].correlationId).toBe('custom-id');
  });
});

describe('redactParameters', () => {
  it('redacts sensitive keys', () => {
    const result = redactParameters({
      password: 'secret',
      token: 'abc',
      apiKey: 'key',
      authorization: 'Bearer xxx',
      safe: 'value',
    });

    expect(result.password).toBe('[REDACTED]');
    expect(result.token).toBe('[REDACTED]');
    expect(result.apiKey).toBe('[REDACTED]');
    expect(result.authorization).toBe('[REDACTED]');
    expect(result.safe).toBe('value');
  });

  it('truncates long string values', () => {
    const longString = 'x'.repeat(300);
    const result = redactParameters({ description: longString });

    expect((result.description as string).length).toBeLessThan(300);
    expect((result.description as string)).toContain('…[truncated]');
  });

  it('preserves non-sensitive short values', () => {
    const result = redactParameters({ name: 'Agent A', count: 5 });
    expect(result.name).toBe('Agent A');
    expect(result.count).toBe(5);
  });
});
