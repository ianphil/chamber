import { describe, expect, it, vi } from 'vitest';
import {
  getA2AAgentCardHandler,
  listA2AAgentsHandler,
  registerA2AAgentCardHandler,
  sendA2AMessageHandler,
} from './a2aHandlers';
import type { A2AWebApiContext } from './types';

describe('A2A web API handlers', () => {
  it('lists A2A agent cards through the injected context', async () => {
    const card = makeA2ACard('Dude', 'dude-1234');
    const listA2AAgents = vi.fn(() => [card]);

    const response = await listA2AAgentsHandler({
      method: 'GET',
      path: '/api/a2a/agents',
      headers: new Headers(),
    }, makeContext({ listA2AAgents }));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ agents: [card] });
  });

  it('gets an A2A agent card by route recipient', async () => {
    const card = makeA2ACard('Dude', 'dude-1234');
    const getA2AAgentCard = vi.fn(() => card);

    const response = await getA2AAgentCardHandler({
      method: 'GET',
      path: '/api/a2a/agents/dude-1234/card',
      headers: new Headers(),
    }, makeContext({ getA2AAgentCard }));

    expect(response.status).toBe(200);
    expect(response.body).toBe(card);
    expect(getA2AAgentCard).toHaveBeenCalledWith('dude-1234');
  });

  it('registers remote A2A inbound auth without putting it on the agent card', async () => {
    const card = makeA2ACard('Copilot CLI');
    const registerA2AAgentCard = vi.fn();
    const inboundAuth = { scheme: 'bearer' as const, token: 'remote-secret' };

    const response = await registerA2AAgentCardHandler({
      method: 'POST',
      path: '/api/a2a/agents',
      headers: new Headers(),
      body: { card, inboundAuth },
    }, makeContext({ registerA2AAgentCard }));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, agent: card });
    expect(registerA2AAgentCard).toHaveBeenCalledWith(card, inboundAuth);
  });

  it('sends A2A messages only to local recipients at the HTTP boundary', async () => {
    const sendA2AMessage = vi.fn(async () => ({
      message: { messageId: 'msg-1', role: 'user' as const, parts: [{ text: 'Hello' }] },
    }));
    const request = {
      recipient: 'dude-1234',
      message: { messageId: 'msg-1', role: 'user' as const, parts: [{ text: 'Hello' }] },
    };

    const response = await sendA2AMessageHandler({
      method: 'POST',
      path: '/api/a2a/message:send',
      headers: new Headers(),
      body: request,
    }, makeContext({ sendA2AMessage }));

    expect(response.status).toBe(200);
    expect(sendA2AMessage).toHaveBeenCalledWith(request, { allowRemoteRecipients: false });
  });

  it('returns safe delivery errors by default', async () => {
    const sendA2AMessage = vi.fn(async () => {
      throw new Error('internal stack detail');
    });

    const response = await sendA2AMessageHandler({
      method: 'POST',
      path: '/api/a2a/message:send',
      headers: new Headers(),
      body: {
        recipient: 'dude-1234',
        message: { messageId: 'msg-1', role: 'user', parts: [{ text: 'Hello' }] },
      },
    }, makeContext({ sendA2AMessage }));

    expect(response.status).toBe(502);
    expect(response.body).toEqual({ error: 'A2A message delivery failed' });
  });
});

function notConfigured(name: string): () => never {
  return () => {
    throw new Error(`Test stub: ${name} not configured`);
  };
}

function makeContext(overrides: Partial<A2AWebApiContext>): A2AWebApiContext {
  return {
    token: 'test-token',
    allowedOrigins: new Set(['http://127.0.0.1']),
    listA2AAgents: notConfigured('listA2AAgents'),
    getA2AAgentCard: notConfigured('getA2AAgentCard'),
    registerA2AAgentCard: notConfigured('registerA2AAgentCard'),
    unregisterA2AAgentCard: notConfigured('unregisterA2AAgentCard'),
    sendA2AMessage: notConfigured('sendA2AMessage'),
    ...overrides,
  };
}

function makeA2ACard(name: string, mindId?: string) {
  return {
    name,
    description: `${name} agent`,
    version: '1.0.0',
    supportedInterfaces: [{ url: 'in-process', protocolBinding: 'IN_PROCESS', protocolVersion: '1.0' }],
    capabilities: {},
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [],
    mindId,
  };
}
