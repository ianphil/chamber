import { Hono } from 'hono';
import type { Context } from 'hono';
import { getRequestListener } from '@hono/node-server';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import {
  addMindHandler,
  cancelChatHandler,
  getAuthStatusHandler,
  getConfigHandler,
  getGenesisStatusHandler,
  healthHandler,
  listAuthAccountsHandler,
  listChamberToolsHandler,
  listLensViewsHandler,
  listModelsHandler,
  listMindsHandler,
  logoutAuthHandler,
  newConversationHandler,
  sendChatHandler,
  switchAuthAccountHandler,
  uploadAttachmentHandler,
} from './handlers';
import { isAllowedOrigin, isAuthorized } from './auth';
import type { ChamberCtx, ChamberRequest, ChamberResponse } from './types';
import { parsePrivilegedRequest, PrivilegedProtocolError } from './privileged-protocol';
import { WIRE_PROTOCOL_VERSION } from '@chamber/wire-contracts';

function toRequest(c: Context): ChamberRequest {
  const url = new URL(c.req.url);
  return {
    method: c.req.method,
    path: url.pathname,
    query: url.searchParams,
    headers: c.req.raw.headers,
  };
}

async function toRequestWithBody(c: Context): Promise<ChamberRequest> {
  const request = toRequest(c);
  if (c.req.header('content-type')?.includes('application/json')) {
    return { ...request, body: await c.req.json() };
  }
  return { ...request, body: await c.req.arrayBuffer() };
}

function send(c: Context, response: ChamberResponse): Response {
  for (const [name, value] of Object.entries(response.headers ?? {})) {
    c.header(name, value);
  }
  return c.json(response.body ?? null, response.status as 200);
}

function streamAuthLogin(c: Context, ctx: ChamberCtx): Response {
  const startAuthLogin = ctx.startAuthLogin;
  if (!startAuthLogin) {
    return c.json({ error: 'Auth login is unavailable' }, 503);
  }

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (event: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      void startAuthLogin((progress) => write({ type: 'progress', progress }))
        .then((result) => write({ type: 'result', result }))
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          write({ type: 'result', result: { success: false, error: message } });
        })
        .finally(() => controller.close());
    },
  });

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function requireAuth(c: Context, ctx: ChamberCtx): Response | null {
  if (!isAllowedOrigin(c.req.header('origin') ?? null, ctx.allowedOrigins)) {
    return c.json({ error: 'Forbidden origin' }, 403);
  }
  if (!isAuthorized(c.req.header('authorization') ?? null, ctx.token)) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  return null;
}

export function createHonoApp(ctx: ChamberCtx): Hono {
  const app = new Hono();

  app.get('/api/health', async (c) => send(c, await healthHandler()));
  const authenticated = (handler: (request: ChamberRequest, context: ChamberCtx) => Promise<ChamberResponse>) => async (c: Context) => {
    const authFailure = requireAuth(c, ctx);
    if (authFailure) return authFailure;
    return send(c, await handler(toRequest(c), ctx));
  };

  app.get('/api/mind/list', authenticated(listMindsHandler));
  app.post('/api/mind/add', async (c) => {
    const authFailure = requireAuth(c, ctx);
    if (authFailure) return authFailure;
    return send(c, await addMindHandler(await toRequestWithBody(c), ctx));
  });
  app.get('/api/config', authenticated(getConfigHandler));
  app.get('/api/lens/list', authenticated(listLensViewsHandler));
  app.get('/api/genesis/status', authenticated(getGenesisStatusHandler));
  app.get('/api/auth/status', authenticated(getAuthStatusHandler));
  app.get('/api/auth/accounts', authenticated(listAuthAccountsHandler));
  app.post('/api/auth/login', async (c) => {
    const authFailure = requireAuth(c, ctx);
    if (authFailure) return authFailure;
    return streamAuthLogin(c, ctx);
  });
  app.post('/api/auth/switch', async (c) => {
    const authFailure = requireAuth(c, ctx);
    if (authFailure) return authFailure;
    return send(c, await switchAuthAccountHandler(await toRequestWithBody(c), ctx));
  });
  app.post('/api/auth/logout', async (c) => {
    const authFailure = requireAuth(c, ctx);
    if (authFailure) return authFailure;
    return send(c, await logoutAuthHandler(toRequest(c), ctx));
  });
  app.get('/api/chamber-tools/list', authenticated(listChamberToolsHandler));
  app.post('/api/attachments', async (c) => {
    const authFailure = requireAuth(c, ctx);
    if (authFailure) return authFailure;
    return send(c, await uploadAttachmentHandler(await toRequestWithBody(c), ctx));
  });
  app.post('/api/chat/cancel', async (c) => {
    const authFailure = requireAuth(c, ctx);
    if (authFailure) return authFailure;
    return send(c, await cancelChatHandler(await toRequestWithBody(c), ctx));
  });
  app.post('/api/chat/send', async (c) => {
    const authFailure = requireAuth(c, ctx);
    if (authFailure) return authFailure;
    return send(c, await sendChatHandler(await toRequestWithBody(c), ctx));
  });
  app.post('/api/chat/new', async (c) => {
    const authFailure = requireAuth(c, ctx);
    if (authFailure) return authFailure;
    return send(c, await newConversationHandler(await toRequestWithBody(c), ctx));
  });
  app.get('/api/chat/models', authenticated(listModelsHandler));
  app.post('/api/privileged', async (c) => {
    const authFailure = requireAuth(c, ctx);
    if (authFailure) return authFailure;
    if (!ctx.handlePrivilegedRequest) return c.json({ error: 'Privileged channel unavailable' }, 503);
    let body: unknown;
    let request;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Privileged request body must be valid JSON.' }, 400);
    }
    try {
      request = parsePrivilegedRequest(body);
    } catch (error) {
      if (error instanceof PrivilegedProtocolError) {
        return c.json({ error: error.message }, 400);
      }
      throw error;
    }
    return c.json(await ctx.handlePrivilegedRequest(request));
  });
  app.post('/api/shutdown', async (c) => {
    const authFailure = requireAuth(c, ctx);
    if (authFailure) return authFailure;
    setTimeout(() => ctx.shutdown?.(), 0);
    return c.json({ ok: true });
  });
  app.get('*', (c) => c.html('<!doctype html><html><body><h1>Chamber server</h1></body></html>'));

  return app;
}

export function createHttpServer(ctx: ChamberCtx) {
  const app = createHonoApp(ctx);
  const server = createServer(getRequestListener((request) => app.fetch(request)));
  const wsServer = new WebSocketServer({ noServer: true });
  const subscriptions = new Map<string, Set<import('ws').WebSocket>>();
  const publish = (sessionId: string, event: unknown): void => {
    ctx.publish?.(sessionId, event);
    for (const ws of subscriptions.get(sessionId) ?? []) {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ version: WIRE_PROTOCOL_VERSION, type: 'chat:event', payload: event }));
      }
    }
  };

  server.on('upgrade', (request, socket, head) => {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    const origin = request.headers.origin ?? null;
    const authorization = request.headers.authorization ?? (
      requestUrl.searchParams.has('token') ? `Bearer ${requestUrl.searchParams.get('token')}` : null
    );
    if (!isAllowedOrigin(origin, ctx.allowedOrigins) || !isAuthorized(authorization, ctx.token)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wsServer.handleUpgrade(request, socket, head, (ws) => {
      ws.send(JSON.stringify({ type: 'hello', version: 1 }));
      const subscribed = new Set<string>();
      ws.on('message', (data) => {
        const message = JSON.parse(data.toString()) as { type?: string; sessionId?: string; event?: unknown };
        if (message.type === 'subscribe' && message.sessionId) {
          subscribed.add(message.sessionId);
          const sockets = subscriptions.get(message.sessionId) ?? new Set();
          sockets.add(ws);
          subscriptions.set(message.sessionId, sockets);
          ws.send(JSON.stringify({ version: 1, type: 'subscription:ready', payload: { sessionId: message.sessionId } }));
        }
      });
      ws.on('close', () => {
        for (const sessionId of subscribed) {
          const sockets = subscriptions.get(sessionId);
          sockets?.delete(ws);
          if (sockets?.size === 0) subscriptions.delete(sessionId);
        }
      });
    });
  });

  return { server, wsServer, publish };
}
