import { describe, expect, it, vi } from 'vitest';
import { RelayA2ARegistryClient } from './RelayA2ARegistryClient';
import type { AgentCard } from './types';

describe('RelayA2ARegistryClient', () => {
  it('allows HTTPS cloud relay URLs and HTTP loopback relay URLs', () => {
    expect(() => makeClient({ baseUrl: 'https://switchboard.example.com' })).not.toThrow();
    expect(() => makeClient({ baseUrl: 'http://127.0.0.1:4100' })).not.toThrow();
    expect(() => makeClient({ baseUrl: 'http://localhost:4100' })).not.toThrow();
  });

  it('rejects insecure non-loopback and credential-bearing relay URLs', () => {
    expect(() => makeClient({ baseUrl: 'http://switchboard.example.com' }))
      .toThrow('A2A relay URL must be HTTPS or HTTP loopback');
    expect(() => makeClient({ baseUrl: 'https://user:pass@switchboard.example.com' }))
      .toThrow('A2A relay URL must not include credentials');
    expect(() => makeClient({ baseUrl: 'ftp://switchboard.example.com' }))
      .toThrow('A2A relay URL must be HTTPS or HTTP loopback');
  });

  it('gets an authorization header from the auth provider for registry requests', async () => {
    const card = makeCard('relay-agent');
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ agents: [card] }), { status: 200 }));
    const authProvider = { getAuthorizationHeader: vi.fn(async () => 'Bearer first-token') };
    const client = makeClient({ fetchImpl, authProvider });

    await expect(client.getCards()).resolves.toEqual([card]);
    expect(authProvider.getAuthorizationHeader).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(new URL('http://127.0.0.1:4100/api/a2a/agents'), expect.objectContaining({
      headers: expect.objectContaining({
        authorization: 'Bearer first-token',
        origin: 'http://127.0.0.1',
      }),
    }));
  });

  it('requests a fresh authorization header for every relay call', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ agents: [] }), { status: 200 }));
    const authProvider = {
      getAuthorizationHeader: vi.fn()
        .mockResolvedValueOnce('Bearer first-token')
        .mockResolvedValueOnce('Bearer second-token'),
    };
    const client = makeClient({ fetchImpl, authProvider });

    await client.getCards();
    await client.getCards();

    expect(authProvider.getAuthorizationHeader).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][1]?.headers).toEqual(expect.objectContaining({ authorization: 'Bearer first-token' }));
    expect(fetchImpl.mock.calls[1][1]?.headers).toEqual(expect.objectContaining({ authorization: 'Bearer second-token' }));
  });

  it('returns null for missing cards', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ error: 'agent not found' }), { status: 404 }));
    const client = makeClient({ fetchImpl });

    await expect(client.getCard('missing')).resolves.toBeNull();
  });

  it('registers cards with inbound auth', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const client = makeClient({ fetchImpl });
    const card = makeCard('relay-agent');

    await client.registerAgent({ card, inboundAuth: { scheme: 'bearer', token: 'inbound-secret' } });

    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toEqual({
      card,
      inboundAuth: { scheme: 'bearer', token: 'inbound-secret' },
    });
  });

  it('passes an abort signal to relay requests', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      expect(input).toBeInstanceOf(URL);
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response(JSON.stringify({ agents: [] }), { status: 200 });
    });
    const client = makeClient({ fetchImpl });

    await client.getCards();
  });

  it('invalidates cached auth when the relay rejects authorization', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }));
    const authProvider = {
      getAuthorizationHeader: vi.fn(async () => 'Bearer wrong-token'),
      invalidate: vi.fn(async () => undefined),
    };
    const client = makeClient({ fetchImpl, authProvider });

    await expect(client.getCards()).rejects.toThrow('unauthorized');
    expect(authProvider.invalidate).toHaveBeenCalledTimes(1);
  });

  it('rejects oversized relay responses', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('x'.repeat(1_000_001), { status: 200 }));
    const client = makeClient({ fetchImpl });

    await expect(client.getCards()).rejects.toThrow('A2A relay response exceeded 1000000 bytes');
  });

  it('sends messages as queued relay requests', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      queued: true,
      queueMessageId: 'relay-msg-1',
      message: { messageId: 'msg-1', role: 'ROLE_USER', parts: [{ text: 'hello' }] },
    }), { status: 200 }));
    const client = makeClient({ fetchImpl });

    await expect(client.sendMessage({
      recipient: 'agent-a',
      message: { messageId: 'msg-1', role: 'ROLE_USER', parts: [{ text: 'hello' }] },
    })).resolves.toEqual(expect.objectContaining({ queued: true, queueMessageId: 'relay-msg-1' }));

    expect(fetchImpl).toHaveBeenCalledWith(new URL('http://127.0.0.1:4100/api/a2a/message:send'), expect.objectContaining({
      method: 'POST',
    }));
  });

  it('polls and acknowledges relay messages', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = input instanceof URL ? input.pathname : String(input);
      if (url.endsWith('/api/a2a/messages:poll')) {
        return new Response(JSON.stringify({
          messages: [{
            id: 'relay-msg-1',
            recipient: 'agent-a',
            request: {
              recipient: 'agent-a',
              message: { messageId: 'msg-1', role: 'ROLE_USER', parts: [{ text: 'hello' }] },
            },
            enqueuedAt: '2026-01-01T00:00:00.000Z',
            attempts: 1,
          }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ acknowledged: 1 }), { status: 200 });
    });
    const client = makeClient({ fetchImpl });

    await expect(client.pollMessages({ recipients: ['agent-a'], limit: 10 })).resolves.toEqual([
      expect.objectContaining({ id: 'relay-msg-1', recipient: 'agent-a' }),
    ]);
    await expect(client.ackMessages(['relay-msg-1'])).resolves.toBe(1);

    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toEqual({ recipients: ['agent-a'], limit: 10 });
    expect(JSON.parse(String(fetchImpl.mock.calls[1][1]?.body))).toEqual({ messageIds: ['relay-msg-1'] });
  });
});

function makeClient(options: {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  authProvider?: { getAuthorizationHeader: () => Promise<string>; invalidate?: () => void | Promise<void> };
} = {}): RelayA2ARegistryClient {
  return new RelayA2ARegistryClient({
    baseUrl: options.baseUrl ?? 'http://127.0.0.1:4100',
    authProvider: options.authProvider ?? { getAuthorizationHeader: async () => 'Bearer secret' },
    fetchImpl: options.fetchImpl,
  });
}

function makeCard(name: string): AgentCard {
  return {
    name,
    description: `${name} description`,
    version: '1.0.0',
    supportedInterfaces: [{ url: 'http://127.0.0.1:4101/a2a', protocolBinding: 'HTTP+JSON', protocolVersion: '1.0' }],
    capabilities: { streaming: true },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [],
  };
}
