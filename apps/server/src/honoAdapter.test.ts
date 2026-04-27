import { request } from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { WebSocketServer } from 'ws';
import { WebSocket } from 'ws';
import { createHttpServer } from './honoAdapter';
import type { ChamberCtx } from './types';

type CreatedServer = ReturnType<typeof createHttpServer>;

const TOKEN = 'test-token';
const ORIGIN = 'http://127.0.0.1';

let currentServer: CreatedServer | null = null;

describe('createHttpServer', () => {
  afterEach(async () => {
    if (!currentServer) return;
    await closeServer(currentServer);
    currentServer = null;
  });

  it('passes JSON POST bodies through to Hono handlers', async () => {
    let switchedLogin: string | null = null;
    const { port } = await startServer({
      switchAuthAccount: (login) => {
        switchedLogin = login;
      },
    });

    const response = await httpRequest(port, {
      method: 'POST',
      path: '/api/auth/switch',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login: 'octocat' }),
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(switchedLogin).toBe('octocat');
  });

  it('streams auth progress before the login attempt completes', async () => {
    const loginCompletion: { finish?: () => void } = {};
    const { port } = await startServer({
      startAuthLogin: async (onProgress) => {
        onProgress({
          step: 'device_code',
          userCode: 'ABCD-EFGH',
          verificationUri: 'https://github.com/login/device',
        });
        await new Promise<void>((resolve) => {
          loginCompletion.finish = resolve;
        });
        return { success: true, login: 'octocat' };
      },
    });

    const stream = streamRequest(port, {
      method: 'POST',
      path: '/api/auth/login',
    });

    try {
      const firstChunk = await withTimeout(stream.firstChunk, 'Timed out waiting for progressive auth chunk');

      expect(firstChunk).toContain('"type":"progress"');
      expect(firstChunk).toContain('"userCode":"ABCD-EFGH"');
      expect(loginCompletion.finish).toBeTypeOf('function');

      loginCompletion.finish?.();
      const body = await stream.done;
      const lines = body.trim().split('\n').map((line) => JSON.parse(line) as { type: string });
      expect(lines.map((line) => line.type)).toEqual(['progress', 'result']);
    } finally {
      loginCompletion.finish?.();
    }
  });

  it('returns 400 for malformed privileged requests', async () => {
    const { port } = await startServer({
      handlePrivilegedRequest: async (request) => ({ ok: true, requestId: request.requestId }),
    });

    const response = await httpRequest(port, {
      method: 'POST',
      path: '/api/privileged',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        protoVersion: 1,
        type: 'credential.setPassword',
        requestId: 'r1',
        payload: { service: 'copilot-cli', account: 'octocat' },
      }),
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: 'credential.setPassword requires payload.password.' });
  });

  it('returns 400 for invalid privileged JSON bodies', async () => {
    const { port } = await startServer({
      handlePrivilegedRequest: async (request) => ({ ok: true, requestId: request.requestId }),
    });

    const response = await httpRequest(port, {
      method: 'POST',
      path: '/api/privileged',
      headers: { 'content-type': 'application/json' },
      body: '{"protoVersion":',
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: 'Privileged request body must be valid JSON.' });
  });

  it('accepts browser WebSocket auth via token query and fans out published chat events', async () => {
    const { port } = await startServer({});
    const ws = new WebSocket(`ws://127.0.0.1:${port}/events?token=${TOKEN}`, {
      headers: { origin: `${ORIGIN}:${port}` },
    });

    try {
      await waitForOpen(ws);
      const ready = waitForMessage(ws, (message) => message.type === 'subscription:ready');
      ws.send(JSON.stringify({ type: 'subscribe', sessionId: 'assistant-1' }));
      await ready;

      currentServer?.publish('assistant-1', {
        mindId: 'dude-1234',
        messageId: 'assistant-1',
        event: { type: 'done' },
      });

      const event = await waitForMessage(ws, (message) => message.type === 'chat:event');
      expect(event.payload).toEqual({
        mindId: 'dude-1234',
        messageId: 'assistant-1',
        event: { type: 'done' },
      });
    } finally {
      ws.close();
    }
  });
});

function makeContext(overrides: Partial<ChamberCtx> = {}): ChamberCtx {
  return {
    token: TOKEN,
    allowedOrigins: new Set([ORIGIN]),
    listMinds: () => [],
    ...overrides,
  };
}

async function startServer(overrides: Partial<ChamberCtx>): Promise<AddressInfo> {
  currentServer = createHttpServer(makeContext(overrides));
  await new Promise<void>((resolve) => {
    currentServer?.server.listen(0, '127.0.0.1', resolve);
  });
  const address = currentServer.server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected test server to listen on a TCP address');
  }
  return address;
}

async function closeServer({ server, wsServer }: { server: CreatedServer['server']; wsServer: WebSocketServer }): Promise<void> {
  wsServer.close();
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

interface BufferedResponse {
  statusCode: number;
  body: string;
}

async function httpRequest(port: number, options: RequestOptions): Promise<BufferedResponse> {
  return new Promise((resolve, reject) => {
    const req = request(baseRequestOptions(port, options), (res) => {
      res.setEncoding('utf8');
      let body = '';
      res.on('data', (chunk: string) => {
        body += chunk;
      });
      res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end(options.body);
  });
}

function streamRequest(port: number, options: RequestOptions): { firstChunk: Promise<string>; done: Promise<string> } {
  let resolveFirstChunk: (chunk: string) => void;
  let rejectFirstChunk: (error: unknown) => void;
  const firstChunk = new Promise<string>((resolve, reject) => {
    resolveFirstChunk = resolve;
    rejectFirstChunk = reject;
  });

  const done = new Promise<string>((resolve, reject) => {
    const req = request(baseRequestOptions(port, options), (res) => {
      res.setEncoding('utf8');
      let body = '';
      res.once('data', (chunk: string) => resolveFirstChunk(chunk));
      res.on('data', (chunk: string) => {
        body += chunk;
      });
      res.on('end', () => resolve(body));
      res.on('error', (error) => {
        rejectFirstChunk(error);
        reject(error);
      });
    });
    req.on('error', (error) => {
      rejectFirstChunk(error);
      reject(error);
    });
    req.end(options.body);
  });

  return { firstChunk, done };
}

function baseRequestOptions(port: number, options: RequestOptions) {
  return {
    hostname: '127.0.0.1',
    port,
    path: options.path,
    method: options.method,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      origin: ORIGIN,
      ...options.headers,
    },
  };
}

async function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), 500);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function waitForOpen(ws: WebSocket): Promise<void> {
  if (ws.readyState === WebSocket.OPEN) return;
  await new Promise<void>((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
}

async function waitForMessage(
  ws: WebSocket,
  predicate: (message: { type?: string; payload?: unknown }) => boolean,
): Promise<{ type?: string; payload?: unknown }> {
  return withTimeout(new Promise((resolve) => {
    ws.on('message', (data) => {
      const message = JSON.parse(String(data)) as { type?: string; payload?: unknown };
      if (predicate(message)) resolve(message);
    });
  }), 'Timed out waiting for WebSocket message');
}
