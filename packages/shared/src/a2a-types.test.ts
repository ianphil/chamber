import { describe, expect, it } from 'vitest';
import { isA2AIncomingPayload, isTaskState, narrowTaskState } from './a2a-types';

describe('A2A contract predicates', () => {
  it('narrows valid task states', () => {
    expect(isTaskState('working')).toBe(true);
    expect(narrowTaskState('completed')).toBe('completed');
  });

  it('rejects invalid task states', () => {
    expect(isTaskState('bogus-status')).toBe(false);
    expect(narrowTaskState('bogus-status')).toBeUndefined();
  });

  it('accepts incoming payloads with a valid user or agent message', () => {
    expect(isA2AIncomingPayload({
      targetMindId: 'agent-b',
      message: { messageId: 'msg-1', role: 'user', parts: [{ text: 'Hello' }] },
      replyMessageId: 'reply-1',
    })).toBe(true);
  });

  it('rejects incoming payloads with invalid message shape', () => {
    expect(isA2AIncomingPayload({
      targetMindId: 'agent-b',
      message: { messageId: 'msg-1', role: 'system', parts: [{ text: 'Hello' }] },
      replyMessageId: 'reply-1',
    })).toBe(false);
    expect(isA2AIncomingPayload({
      targetMindId: 'agent-b',
      message: { messageId: 'msg-1', role: 'user' },
      replyMessageId: 'reply-1',
    })).toBe(false);
  });
});
