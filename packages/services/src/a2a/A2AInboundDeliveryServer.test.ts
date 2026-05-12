import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { A2AInboundDeliveryServer } from './A2AInboundDeliveryServer';
import type { MessageRouter } from './MessageRouter';

const token = 'inbound-secret';

let server: A2AInboundDeliveryServer | null = null;
let messageRouter: { deliverToLocalMind: ReturnType<typeof vi.fn> };

beforeEach(() => {
  messageRouter = {
    deliverToLocalMind: vi.fn(async (_mindId, request) => ({ message: request.message })),
  };
});

afterEach(async () => {
  await server?.stop();
  server = null;
});

describe('A2AInboundDeliveryServer', () => {
  it('requires bearer auth', async () => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/api/a2a/message:send`, {
      method: 'POST',
      body: JSON.stringify(makeRequest('mind-a')),
    });

    expect(response.status).toBe(401);
    expect(messageRouter.deliverToLocalMind).not.toHaveBeenCalled();
  });

  it('delivers valid A2A messages to the target mind from the query string', async () => {
    const { baseUrl } = await startServer();

    const response = await inboundFetch(`${baseUrl}/api/a2a/message:send?mindId=mind-a`, makeRequest('relay-recipient'));

    expect(response.status).toBe(200);
    expect(messageRouter.deliverToLocalMind).toHaveBeenCalledWith('mind-a', makeRequest('relay-recipient'));
  });

  it('falls back to request recipient when no query mind id is present', async () => {
    const { baseUrl } = await startServer();

    await inboundFetch(`${baseUrl}/api/a2a/message:send`, makeRequest('mind-b'));

    expect(messageRouter.deliverToLocalMind).toHaveBeenCalledWith('mind-b', makeRequest('mind-b'));
  });

  it('rejects oversized bodies', async () => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/api/a2a/message:send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: 'x'.repeat(1_000_001),
    });

    expect(response.status).toBe(413);
    expect(messageRouter.deliverToLocalMind).not.toHaveBeenCalled();
  });

  it('uses a caller-provided token when one is supplied at start', async () => {
    server = new A2AInboundDeliveryServer({
      token,
      messageRouter: messageRouter as unknown as MessageRouter,
    });
    const { baseUrl, token: activeToken } = await server.start(0, 'custom-inbound-token');

    expect(activeToken).toBe('custom-inbound-token');
    const response = await fetch(`${baseUrl}/api/a2a/message:send`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer custom-inbound-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify(makeRequest('mind-c')),
    });

    expect(response.status).toBe(200);
    expect(messageRouter.deliverToLocalMind).toHaveBeenCalledWith('mind-c', makeRequest('mind-c'));
  });
});

async function startServer(): Promise<{ baseUrl: string }> {
  server = new A2AInboundDeliveryServer({
    token,
    messageRouter: messageRouter as unknown as MessageRouter,
  });
  return server.start();
}

function inboundFetch(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function makeRequest(recipient: string) {
  return {
    recipient,
    message: {
      messageId: 'msg-1',
      role: 'ROLE_USER',
      parts: [{ text: 'hello', mediaType: 'text/plain' }],
    },
  };
}
