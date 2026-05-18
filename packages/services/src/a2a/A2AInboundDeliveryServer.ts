import { createServer, type Server } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { MessageRouter } from './MessageRouter';
import type { SendMessageRequest } from './types';

const MAX_REQUEST_BYTES = 1_000_000;

export interface A2AInboundDeliveryServerOptions {
  token: string;
  messageRouter: MessageRouter;
  log?: (message: string, error?: unknown) => void;
}

export class A2AInboundDeliveryServer {
  private server: Server | null = null;
  private port = 0;
  private token: string;

  constructor(private readonly options: A2AInboundDeliveryServerOptions) {
    this.token = options.token;
  }

  async start(requestedPort = 0, token = this.token): Promise<{ baseUrl: string; token: string }> {
    const nextToken = token.trim();
    if (!nextToken) throw new Error('A2A inbound delivery token is required');
    if (this.server?.listening && this.port) {
      if (nextToken !== this.token) {
        throw new Error('A2A inbound delivery server is already running with a different token');
      }
      return { baseUrl: this.getBaseUrl(), token: this.token };
    }
    this.token = nextToken;

    this.server = createServer(async (request, response) => {
      try {
        if (!isAuthorized(request.headers.authorization, this.token)) {
          return sendJson(response, 401, { error: 'unauthorized' });
        }

        const url = new URL(request.url ?? '/', 'http://127.0.0.1');
        if (request.method !== 'POST' || url.pathname !== '/api/a2a/message:send') {
          return sendJson(response, 404, { error: 'not found' });
        }

        const body = await readJson(request);
        if (!isSendMessageRequest(body)) {
          return sendJson(response, 400, { error: 'valid A2A SendMessageRequest is required' });
        }

        const targetMindId = url.searchParams.get('mindId') || body.recipient;
        const result = await this.options.messageRouter.deliverToLocalMind(targetMindId, body);
        return sendJson(response, 200, result);
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return sendJson(response, 413, { error: 'request body too large' });
        }
        if (error instanceof SyntaxError) {
          return sendJson(response, 400, { error: 'request body must be valid JSON' });
        }
        this.options.log?.('A2A inbound delivery failed', error);
        return sendJson(response, 500, { error: 'internal server error' });
      }
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(requestedPort, '127.0.0.1', () => {
        this.server?.off('error', reject);
        const address = this.server?.address();
        this.port = typeof address === 'object' && address ? address.port : requestedPort;
        resolve();
      });
    });

    return { baseUrl: this.getBaseUrl(), token: this.token };
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server?.listening) {
        this.server = null;
        this.port = 0;
        resolve();
        return;
      }
      const server = this.server;
      this.server = null;
      this.port = 0;
      server.close(() => resolve());
    });
  }

  getBaseUrl(): string {
    if (!this.port) throw new Error('A2A inbound delivery server is not running');
    return `http://127.0.0.1:${this.port}`;
  }

  isRunning(): boolean {
    return Boolean(this.server?.listening && this.port);
  }
}

async function readJson(request: NodeJS.ReadableStream): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > MAX_REQUEST_BYTES) throw new RequestBodyTooLargeError();
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}');
}

function isAuthorized(authorizationHeader: string | undefined, token: string): boolean {
  if (!authorizationHeader?.startsWith('Bearer ')) return false;
  const actual = Buffer.from(authorizationHeader.slice('Bearer '.length), 'utf8');
  const expected = Buffer.from(token, 'utf8');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function sendJson(response: { writeHead: (status: number, headers: Record<string, string>) => void; end: (body: string) => void }, status: number, body: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/a2a+json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

function isSendMessageRequest(value: unknown): value is SendMessageRequest {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as SendMessageRequest).recipient === 'string' &&
    (value as SendMessageRequest).message &&
    typeof (value as SendMessageRequest).message === 'object' &&
    typeof (value as SendMessageRequest).message.messageId === 'string' &&
    ((value as SendMessageRequest).message.role === 'ROLE_USER' ||
      (value as SendMessageRequest).message.role === 'ROLE_AGENT') &&
    Array.isArray((value as SendMessageRequest).message.parts),
  );
}

class RequestBodyTooLargeError extends Error {}
