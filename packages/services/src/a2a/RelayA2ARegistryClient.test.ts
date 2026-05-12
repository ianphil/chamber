import { describe, expect, it, vi } from 'vitest';
import { RelayA2ARegistryClient } from './RelayA2ARegistryClient';
import type { AgentCard } from './types';

describe('RelayA2ARegistryClient', () => {
  it('requires an HTTP loopback relay URL', () => {
    expect(() => new RelayA2ARegistryClient({ baseUrl: 'https://example.com', token: 'secret' }))
      .toThrow('A2A relay URL must be an HTTP loopback URL');
  });

  it('sends authenticated registry requests', async () => {
    const card = makeCard('relay-agent');
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ agents: [card] }), { status: 200 }));
    const client = new RelayA2ARegistryClient({ baseUrl: 'http://127.0.0.1:4100', token: 'secret', fetchImpl });

    await expect(client.getCards()).resolves.toEqual([card]);
    expect(fetchImpl).toHaveBeenCalledWith(new URL('http://127.0.0.1:4100/api/a2a/agents'), expect.objectContaining({
      headers: expect.objectContaining({ authorization: 'Bearer secret' }),
    }));
  });

  it('returns null for missing cards', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ error: 'agent not found' }), { status: 404 }));
    const client = new RelayA2ARegistryClient({ baseUrl: 'http://127.0.0.1:4100', token: 'secret', fetchImpl });

    await expect(client.getCard('missing')).resolves.toBeNull();
  });

  it('registers cards with inbound auth', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const client = new RelayA2ARegistryClient({ baseUrl: 'http://127.0.0.1:4100', token: 'secret', fetchImpl });
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
    const client = new RelayA2ARegistryClient({ baseUrl: 'http://127.0.0.1:4100', token: 'secret', fetchImpl });

    await client.getCards();
  });

  it('rejects oversized relay responses', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('x'.repeat(1_000_001), { status: 200 }));
    const client = new RelayA2ARegistryClient({ baseUrl: 'http://127.0.0.1:4100', token: 'secret', fetchImpl });

    await expect(client.getCards()).rejects.toThrow('A2A relay response exceeded 1000000 bytes');
  });

  it('sends messages as queued relay requests', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      queued: true,
      queueMessageId: 'relay-msg-1',
      message: { messageId: 'msg-1', role: 'user', parts: [{ text: 'hello' }] },
    }), { status: 200 }));
    const client = new RelayA2ARegistryClient({ baseUrl: 'http://127.0.0.1:4100', token: 'secret', fetchImpl });

    await expect(client.sendMessage({
      recipient: 'agent-a',
      message: { messageId: 'msg-1', role: 'user', parts: [{ text: 'hello' }] },
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
              message: { messageId: 'msg-1', role: 'user', parts: [{ text: 'hello' }] },
            },
            enqueuedAt: '2026-01-01T00:00:00.000Z',
            attempts: 1,
          }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ acknowledged: 1 }), { status: 200 });
    });
    const client = new RelayA2ARegistryClient({ baseUrl: 'http://127.0.0.1:4100', token: 'secret', fetchImpl });

    await expect(client.pollMessages({ recipients: ['agent-a'], limit: 10 })).resolves.toEqual([
      expect.objectContaining({ id: 'relay-msg-1', recipient: 'agent-a' }),
    ]);
    await expect(client.ackMessages(['relay-msg-1'])).resolves.toBe(1);

    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toEqual({ recipients: ['agent-a'], limit: 10 });
    expect(JSON.parse(String(fetchImpl.mock.calls[1][1]?.body))).toEqual({ messageIds: ['relay-msg-1'] });
  });
});

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
