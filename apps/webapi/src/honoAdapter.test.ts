import { request } from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createA2AHttpServer } from './honoAdapter';
import type { A2AWebApiContext, WebApiServerControls } from './types';

const TOKEN = 'test-token';
const ORIGIN = 'http://127.0.0.1';

let currentServer: WebApiServerControls | null = null;

describe('createA2AHttpServer', () => {
  afterEach(async () => {
    if (!currentServer) return;
    await closeServer(currentServer);
    currentServer = null;
  });

  it('serves health without authentication', async () => {
    const { port } = await startServer({});
    const response = await rawHttpRequest(port, {
      method: 'GET',
      path: '/api/health',
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
  });

  it('enforces bearer auth on A2A routes', async () => {
    const { port } = await startServer({});
    const response = await rawHttpRequest(port, {
      method: 'GET',
      path: '/api/a2a/agents',
      headers: { origin: ORIGIN },
    });

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body)).toEqual({ error: 'Unauthorized' });
  });

  it('exposes the standard message:send alias as authenticated A2A', async () => {
    const sendA2AMessage = vi.fn(async () => ({
      message: { messageId: 'msg-1', role: 'user' as const, parts: [{ text: 'Hello' }] },
    }));
    const { port } = await startServer({ sendA2AMessage });

    const response = await httpRequest(port, {
      method: 'POST',
      path: '/message:send',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        recipient: 'dude-1234',
        message: { messageId: 'msg-1', role: 'user', parts: [{ text: 'Hello' }] },
      }),
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      message: { messageId: 'msg-1', role: 'user', parts: [{ text: 'Hello' }] },
    });
    expect(sendA2AMessage).toHaveBeenCalledWith(expect.any(Object), { allowRemoteRecipients: false });
  });

  it('caps JSON request bodies before parsing', async () => {
    const { port } = await startServer({}, { maxBodyBytes: 32 });

    const response = await httpRequest(port, {
      method: 'POST',
      path: '/api/a2a/message:send',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload: 'x'.repeat(128) }),
    });

    expect(response.statusCode).toBe(413);
    expect(JSON.parse(response.body)).toEqual({ error: 'request body too large' });
  });

  it('does not expose server-only routes on the A2A host', async () => {
    const { port } = await startServer({});
    const response = await httpRequest(port, {
      method: 'POST',
      path: '/api/privileged',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body)).toEqual({ error: 'not found' });
  });
});

function notConfigured(name: string): () => never {
  return () => {
    throw new Error(`Test stub: ${name} not configured`);
  };
}

function makeContext(overrides: Partial<A2AWebApiContext> = {}): A2AWebApiContext {
  return {
    token: TOKEN,
    allowedOrigins: new Set([ORIGIN, 'http://localhost']),
    listA2AAgents: () => [],
    getA2AAgentCard: notConfigured('getA2AAgentCard'),
    registerA2AAgentCard: notConfigured('registerA2AAgentCard'),
    unregisterA2AAgentCard: notConfigured('unregisterA2AAgentCard'),
    sendA2AMessage: notConfigured('sendA2AMessage'),
    ...overrides,
  };
}

async function startServer(
  overrides: Partial<A2AWebApiContext>,
  options: Parameters<typeof createA2AHttpServer>[1] = {},
): Promise<AddressInfo> {
  currentServer = createA2AHttpServer(makeContext(overrides), options);
  await new Promise<void>((resolve) => {
    currentServer?.server.listen(0, '127.0.0.1', resolve);
  });
  const address = currentServer.server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected test server to listen on a TCP address');
  }
  return address;
}

async function closeServer({ server }: WebApiServerControls): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

interface RequestOptions {
  method: string;
  path: string;
  headers?: IncomingHttpHeaders;
  body?: string;
}

function httpRequest(port: number, options: RequestOptions): Promise<{ statusCode: number; body: string }> {
  return rawHttpRequest(port, {
    ...options,
    headers: {
      origin: ORIGIN,
      authorization: `Bearer ${TOKEN}`,
      ...(options.headers ?? {}),
    },
  });
}

function rawHttpRequest(port: number, options: RequestOptions): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1',
      port,
      path: options.path,
      method: options.method,
      headers: options.headers,
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}
