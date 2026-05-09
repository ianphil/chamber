import { createServer } from 'node:http';
import { getRequestListener } from '@hono/node-server';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { isAllowedOrigin, isAuthorized } from './auth';
import {
  getA2AAgentCardHandler,
  healthHandler,
  listA2AAgentsHandler,
  registerA2AAgentCardHandler,
  sendA2AMessageHandler,
  unregisterA2AAgentCardHandler,
} from './a2aHandlers';
import type { A2AWebApiContext, A2AWebApiOptions, ChamberRequest, ChamberResponse, WebApiServerControls } from './types';

export const DEFAULT_A2A_MAX_BODY_BYTES = 1_000_000;

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

export function send(c: Context, response: ChamberResponse): Response {
  for (const [name, value] of Object.entries(response.headers ?? {})) {
    c.header(name, value);
  }
  return c.json(response.body ?? null, response.status as 200);
}

export function requireAuth(c: Context, ctx: Pick<A2AWebApiContext, 'allowedOrigins' | 'token'>): Response | null {
  if (!isAllowedOrigin(c.req.header('origin') ?? null, ctx.allowedOrigins)) {
    return c.json({ error: 'Forbidden origin' }, 403);
  }
  if (!isAuthorized(c.req.header('authorization') ?? null, ctx.token)) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  return null;
}

export function registerA2ARoutes(app: Hono, ctx: A2AWebApiContext, options: A2AWebApiOptions = {}): void {
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_A2A_MAX_BODY_BYTES;
  const requireA2AAuth = (c: Context): Response | null => requireAuth(c, ctx);
  const limitedJsonBody = bodyLimit({
    maxSize: maxBodyBytes,
    onError: (c) => c.json({ error: 'request body too large' }, 413),
  });

  app.get('/api/health', async (c) => send(c, await healthHandler()));
  app.get('/api/a2a/agents', async (c) => {
    const authFailure = requireA2AAuth(c);
    if (authFailure) return authFailure;
    return send(c, await listA2AAgentsHandler(toRequest(c), ctx));
  });
  app.get('/api/a2a/agents/:recipient/card', async (c) => {
    const authFailure = requireA2AAuth(c);
    if (authFailure) return authFailure;
    return send(c, await getA2AAgentCardHandler(toRequest(c), ctx));
  });
  app.post('/api/a2a/agents', limitedJsonBody, async (c) => {
    const authFailure = requireA2AAuth(c);
    if (authFailure) return authFailure;
    return send(c, await registerA2AAgentCardHandler(await toRequestWithBody(c), ctx));
  });
  app.delete('/api/a2a/agents/:recipient', async (c) => {
    const authFailure = requireA2AAuth(c);
    if (authFailure) return authFailure;
    return send(c, await unregisterA2AAgentCardHandler(toRequest(c), ctx));
  });
  app.post('/api/a2a/message:send', limitedJsonBody, async (c) => {
    const authFailure = requireA2AAuth(c);
    if (authFailure) return authFailure;
    return send(c, await sendA2AMessageHandler(await toRequestWithBody(c), ctx, options));
  });
  app.post('/message:send', limitedJsonBody, async (c) => {
    const authFailure = requireA2AAuth(c);
    if (authFailure) return authFailure;
    return send(c, await sendA2AMessageHandler(await toRequestWithBody(c), ctx, options));
  });
}

export function createA2AHonoApp(ctx: A2AWebApiContext, options: A2AWebApiOptions = {}): Hono {
  const app = new Hono();
  registerA2ARoutes(app, ctx, options);
  app.notFound((c) => c.json({ error: 'not found' }, 404));
  return app;
}

export function createA2AHttpServer(ctx: A2AWebApiContext, options: A2AWebApiOptions = {}): WebApiServerControls {
  const app = createA2AHonoApp(ctx, options);
  const server = createServer(getRequestListener((request) => app.fetch(request)));
  return { server };
}
