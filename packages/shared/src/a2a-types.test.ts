import { describe, expect, it } from 'vitest';
import { isA2AIncomingPayload, isA2ARelayConnectRequest, isTaskState, narrowTaskState } from './a2a-types';

describe('A2A contract predicates', () => {
  it('narrows valid task states', () => {
    expect(isTaskState('TASK_STATE_WORKING')).toBe(true);
    expect(narrowTaskState('TASK_STATE_COMPLETED')).toBe('TASK_STATE_COMPLETED');
  });

  it('rejects invalid task states', () => {
    expect(isTaskState('bogus-status')).toBe(false);
    expect(narrowTaskState('bogus-status')).toBeUndefined();
  });

  it('narrows valid static relay connect requests', () => {
    expect(isA2ARelayConnectRequest({
      relayBaseUrl: 'http://127.0.0.1:4317',
      authMode: 'static',
      relayToken: 'secret',
      publishedBaseUrl: 'http://127.0.0.1:4488',
      inboundToken: 'inbound',
    })).toBe(true);
    expect(isA2ARelayConnectRequest({
      relayBaseUrl: 'http://127.0.0.1:4317',
      authMode: 'static',
    })).toBe(true);
  });

  it('narrows valid interactive and auto relay connect requests without static tokens', () => {
    expect(isA2ARelayConnectRequest({
      relayBaseUrl: 'https://switchboard.example.com',
      authMode: 'interactive',
      clientId: 'client-id',
      tenantId: 'common',
      scope: 'api://client-id/user_impersonation',
    })).toBe(true);
    expect(isA2ARelayConnectRequest({
      relayBaseUrl: 'https://switchboard.example.com',
      authMode: 'auto',
      clientId: 'client-id',
    })).toBe(true);
    expect(isA2ARelayConnectRequest({
      relayBaseUrl: 'https://switchboard.example.com',
      authMode: 'auto',
    })).toBe(true);
  });

  it('defaults legacy relay connect requests with a token to static auth', () => {
    expect(isA2ARelayConnectRequest({
      relayBaseUrl: 'http://127.0.0.1:4317',
      relayToken: 'secret',
    })).toBe(true);
  });

  it('rejects invalid relay connect auth shapes', () => {
    expect(isA2ARelayConnectRequest({ relayBaseUrl: '', authMode: 'static', relayToken: 'secret' })).toBe(false);
    expect(isA2ARelayConnectRequest({ relayBaseUrl: 'http://127.0.0.1:4317', authMode: 'static', relayToken: '' })).toBe(false);
    expect(isA2ARelayConnectRequest({ relayBaseUrl: 'https://switchboard.example.com', authMode: 'interactive', relayToken: 'secret' })).toBe(false);
    expect(isA2ARelayConnectRequest({ relayBaseUrl: 'https://switchboard.example.com', authMode: 'bogus' })).toBe(false);
  });

  it('accepts incoming payloads with a valid user or agent message', () => {
    expect(isA2AIncomingPayload({
      targetMindId: 'agent-b',
      message: { messageId: 'msg-1', role: 'ROLE_USER', parts: [{ text: 'Hello' }] },
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
      message: { messageId: 'msg-1', role: 'ROLE_USER' },
      replyMessageId: 'reply-1',
    })).toBe(false);
  });
});
