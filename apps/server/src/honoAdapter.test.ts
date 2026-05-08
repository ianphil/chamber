import { request } from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

  describe('auth header enforcement', () => {
    it('returns 401 when the Authorization header is missing', async () => {
      const { port } = await startServer({});
      const response = await rawHttpRequest(port, {
        method: 'GET',
        path: '/api/mind/list',
        headers: { origin: ORIGIN },
      });
      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body)).toEqual({ error: 'Unauthorized' });
    });

    it('returns 401 when the Authorization scheme is not Bearer', async () => {
      const { port } = await startServer({});
      const response = await rawHttpRequest(port, {
        method: 'GET',
        path: '/api/mind/list',
        headers: { origin: ORIGIN, authorization: `Basic ${TOKEN}` },
      });
      expect(response.statusCode).toBe(401);
    });

    it('returns 401 when the Bearer token does not match', async () => {
      const { port } = await startServer({});
      const response = await rawHttpRequest(port, {
        method: 'GET',
        path: '/api/mind/list',
        headers: { origin: ORIGIN, authorization: `Bearer not-the-token` },
      });
      expect(response.statusCode).toBe(401);
    });

    it('accepts the configured Bearer token', async () => {
      const { port } = await startServer({});
      const response = await httpRequest(port, {
        method: 'GET',
        path: '/api/mind/list',
      });
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ minds: [] });
    });
  });

  describe('origin allowlist', () => {
    it('rejects requests from a disallowed origin', async () => {
      const { port } = await startServer({});
      const response = await rawHttpRequest(port, {
        method: 'GET',
        path: '/api/mind/list',
        headers: {
          origin: 'https://evil.example.com',
          authorization: `Bearer ${TOKEN}`,
        },
      });
      expect(response.statusCode).toBe(403);
      expect(JSON.parse(response.body)).toEqual({ error: 'Forbidden origin' });
    });

    it('allows requests with no Origin header (native fetchers)', async () => {
      const { port } = await startServer({});
      const response = await rawHttpRequest(port, {
        method: 'GET',
        path: '/api/mind/list',
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      expect(response.statusCode).toBe(200);
    });

    it('allows loopback origins on any port when the host matches the allowlist', async () => {
      const { port } = await startServer({});
      const response = await rawHttpRequest(port, {
        method: 'GET',
        path: '/api/mind/list',
        headers: {
          origin: `http://127.0.0.1:${port}`,
          authorization: `Bearer ${TOKEN}`,
        },
      });
      expect(response.statusCode).toBe(200);
    });
  });

  describe('route availability', () => {
    it('serves the placeholder HTML on the catch-all GET route without auth', async () => {
      const { port } = await startServer({});
      const response = await rawHttpRequest(port, {
        method: 'GET',
        path: '/anything-else',
        headers: {},
      });
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('<h1>Chamber server</h1>');
    });
  });

  describe('shutdown', () => {
    it('schedules ctx.shutdown asynchronously and replies 200 immediately', async () => {
      const shutdown = vi.fn();
      const { port } = await startServer({ shutdown });
      const response = await httpRequest(port, {
        method: 'POST',
        path: '/api/shutdown',
      });
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ ok: true });
      // setTimeout(..., 0) means shutdown runs on the next tick after the response is flushed.
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(shutdown).toHaveBeenCalledTimes(1);
    });

    it('responds 200 immediately even when the shutdown handler is a noop', async () => {
      const { port } = await startServer({});
      const response = await httpRequest(port, {
        method: 'POST',
        path: '/api/shutdown',
      });
      expect(response.statusCode).toBe(200);
    });
  });

  describe('attachment upload', () => {
    it('forwards the binary body to ctx.saveAttachment with the requested name', async () => {
      const saveAttachment = vi.fn(async ({ name, body }: { name: string; body: ArrayBuffer }) => ({
        name,
        size: body.byteLength,
      }));
      const { port } = await startServer({ saveAttachment });
      const response = await httpRequest(port, {
        method: 'POST',
        path: '/api/attachments?name=image.png',
        headers: { 'content-type': 'application/octet-stream' },
        body: 'binary-bytes',
      });
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ name: 'image.png', size: 12 });
      expect(saveAttachment).toHaveBeenCalledTimes(1);
      const call = saveAttachment.mock.calls[0][0];
      expect(call.name).toBe('image.png');
      expect(call.body).toBeInstanceOf(ArrayBuffer);
      expect(Buffer.from(call.body).toString('utf8')).toBe('binary-bytes');
    });

    it('returns 400 when the name query parameter is missing', async () => {
      const saveAttachment = vi.fn();
      const { port } = await startServer({ saveAttachment });
      const response = await httpRequest(port, {
        method: 'POST',
        path: '/api/attachments',
        headers: { 'content-type': 'application/octet-stream' },
        body: 'binary-bytes',
      });
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toEqual({ error: 'Attachment name is required' });
      expect(saveAttachment).not.toHaveBeenCalled();
    });

    it('returns 400 when the body is JSON instead of binary', async () => {
      const saveAttachment = vi.fn();
      const { port } = await startServer({ saveAttachment });
      const response = await httpRequest(port, {
        method: 'POST',
        path: '/api/attachments?name=image.png',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ data: 'oops' }),
      });
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toEqual({ error: 'Attachment body is required' });
      expect(saveAttachment).not.toHaveBeenCalled();
    });
  });

  describe('chat cancel', () => {
    it('forwards the mindId and messageId to ctx.cancelChat', async () => {
      const cancelChat = vi.fn(async () => undefined);
      const { port } = await startServer({ cancelChat });
      const response = await httpRequest(port, {
        method: 'POST',
        path: '/api/chat/cancel',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mindId: 'dude-1234', messageId: 'assistant-1' }),
      });
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ ok: true });
      expect(cancelChat).toHaveBeenCalledWith('dude-1234', 'assistant-1');
    });

    it('returns 400 when mindId is missing', async () => {
      const cancelChat = vi.fn();
      const { port } = await startServer({ cancelChat });
      const response = await httpRequest(port, {
        method: 'POST',
        path: '/api/chat/cancel',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messageId: 'assistant-1' }),
      });
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toEqual({ error: 'mindId is required' });
      expect(cancelChat).not.toHaveBeenCalled();
    });

    it('returns 400 when messageId is missing', async () => {
      const cancelChat = vi.fn();
      const { port } = await startServer({ cancelChat });
      const response = await httpRequest(port, {
        method: 'POST',
        path: '/api/chat/cancel',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mindId: 'dude-1234' }),
      });
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toEqual({ error: 'messageId is required' });
      expect(cancelChat).not.toHaveBeenCalled();
    });
  });

  describe('WebSocket upgrade authorization', () => {
    it('rejects upgrades that do not present a token', async () => {
      const { port } = await startServer({});
      const ws = new WebSocket(`ws://127.0.0.1:${port}/events`, {
        headers: { origin: `${ORIGIN}:${port}` },
      });
      const status = await waitForUpgradeRejection(ws);
      expect(status).toBe(401);
    });

    it('rejects upgrades whose query token is wrong', async () => {
      const { port } = await startServer({});
      const ws = new WebSocket(`ws://127.0.0.1:${port}/events?token=not-the-token`, {
        headers: { origin: `${ORIGIN}:${port}` },
      });
      const status = await waitForUpgradeRejection(ws);
      expect(status).toBe(401);
    });

    it('rejects upgrades from a disallowed origin', async () => {
      const { port } = await startServer({});
      const ws = new WebSocket(`ws://127.0.0.1:${port}/events?token=${TOKEN}`, {
        headers: { origin: 'https://evil.example.com' },
      });
      const status = await waitForUpgradeRejection(ws);
      expect(status).toBe(401);
    });

    it('accepts upgrades that authenticate via the Authorization header instead of the query token', async () => {
      const { port } = await startServer({});
      const ws = new WebSocket(`ws://127.0.0.1:${port}/events`, {
        headers: {
          origin: `${ORIGIN}:${port}`,
          authorization: `Bearer ${TOKEN}`,
        },
      });
      try {
        await waitForOpen(ws);
        expect(ws.readyState).toBe(WebSocket.OPEN);
      } finally {
        ws.close();
      }
    });
  });
});

function notConfigured(name: string): () => never {
  return () => {
    throw new Error(`Test stub: ${name} not configured`);
  };
}

function makeContext(overrides: Partial<ChamberCtx> = {}): ChamberCtx {
  return {
    token: TOKEN,
    allowedOrigins: new Set([ORIGIN]),
    listMinds: () => [],
    addMind: notConfigured('addMind'),
    getConfig: notConfigured('getConfig'),
    listLensViews: notConfigured('listLensViews'),
    getGenesisStatus: notConfigured('getGenesisStatus'),
    getAuthStatus: notConfigured('getAuthStatus'),
    listAuthAccounts: notConfigured('listAuthAccounts'),
    startAuthLogin: notConfigured('startAuthLogin'),
    switchAuthAccount: notConfigured('switchAuthAccount'),
    logoutAuth: notConfigured('logoutAuth'),
    listChamberTools: notConfigured('listChamberTools'),
    saveAttachment: notConfigured('saveAttachment'),
    sendChat: notConfigured('sendChat'),
    newConversation: notConfigured('newConversation'),
    cancelChat: notConfigured('cancelChat'),
    listModels: notConfigured('listModels'),
    shutdown: () => {},
    handlePrivilegedRequest: notConfigured('handlePrivilegedRequest'),
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

async function rawHttpRequest(
  port: number,
  options: { method: string; path: string; headers: IncomingHttpHeaders; body?: string },
): Promise<BufferedResponse> {
  return new Promise((resolve, reject) => {
    const req = request({
      hostname: '127.0.0.1',
      port,
      path: options.path,
      method: options.method,
      headers: options.headers,
    }, (res) => {
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

async function waitForUpgradeRejection(ws: WebSocket): Promise<number> {
  return withTimeout(new Promise<number>((resolve, reject) => {
    ws.on('unexpected-response', (_request, response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    ws.on('open', () => reject(new Error('Expected upgrade to be rejected, but the socket opened')));
    ws.on('error', () => {
      // ws emits "error" alongside "unexpected-response" or when the socket is destroyed.
      // We rely on "unexpected-response" for the status code; ignore the bare error.
    });
  }), 'Timed out waiting for WebSocket upgrade rejection');
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
