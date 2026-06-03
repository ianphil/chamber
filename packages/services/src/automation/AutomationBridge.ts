import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { Logger } from '../logger';
import { TokenRegistry } from './TokenRegistry';

const log = Logger.create('automation-bridge');

export const MAX_BRIDGE_BODY_BYTES = 64 * 1024;

export interface BridgePromptRequest {
  mindId: string;
  prompt: string;
  recipient?: string;
}

export interface BridgeNotifyRequest {
  mindId: string;
  title: string;
  body: string;
}

export interface BridgeA2ARequest {
  mindId: string;
  recipient: string;
  message: string;
  contextId?: string;
  referenceTaskIds?: string[];
}

export interface BridgeHandlers {
  /**
   * Invoked when an automation script posts /prompt. Runs unattended (no
   * interactive user approval prompts). The prompt executes against the
   * mind's standard isolated session, which inherits the mind's normal
   * session permission posture — tool calls are auto-approved, not gated by
   * a human, since cron fires have no operator present. Because automation
   * scripts are user-authored, the script author is the trust boundary.
   */
  onPrompt: (req: BridgePromptRequest) => Promise<{ text: string }>;
  onNotify: (req: BridgeNotifyRequest) => Promise<void>;
  onA2a?: (req: BridgeA2ARequest) => Promise<Record<string, unknown>>;
}

interface BridgeStartResult {
  url: string;
  port: number;
  stop: () => Promise<void>;
}

export class AutomationBridge {
  readonly tokens = new TokenRegistry();
  private server: http.Server | null = null;
  private listening = false;

  constructor(private readonly handlers: BridgeHandlers) {}

  async start(): Promise<BridgeStartResult> {
    if (this.listening) {
      throw new Error('AutomationBridge already started');
    }
    const server = http.createServer((req, res) => {
      void this.dispatch(req, res).catch((err) => {
        log.error('Bridge dispatch threw:', err);
        if (!res.headersSent) {
          this.sendJson(res, 500, { error: 'internal' });
        }
      });
    });
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => {
        server.off('listening', onListen);
        reject(err);
      };
      const onListen = () => {
        server.off('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListen);
      server.listen(0, '127.0.0.1');
    });
    this.listening = true;
    const address = server.address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}`;
    return {
      url,
      port: address.port,
      stop: () => this.stop(),
    };
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    this.listening = false;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private async dispatch(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const remote = req.socket.remoteAddress ?? '';
    if (!isLoopback(remote)) {
      this.sendJson(res, 403, { error: 'loopback-only' });
      return;
    }
    if (req.method !== 'POST') {
      this.sendJson(res, 405, { error: 'method-not-allowed' });
      return;
    }

    const auth = req.headers.authorization;
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) {
      this.sendJson(res, 401, { error: 'unauthorized' });
      return;
    }
    const providedToken = auth.slice('Bearer '.length).trim();
    const tokenMatch = this.tokens.verify(providedToken);
    if (!tokenMatch) {
      this.sendJson(res, 401, { error: 'unauthorized' });
      return;
    }

    let body: unknown;
    try {
      body = await readJsonBody(req, MAX_BRIDGE_BODY_BYTES);
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.code === 'BODY_TOO_LARGE') {
        this.sendJson(res, 413, { error: 'body-too-large' });
        return;
      }
      this.sendJson(res, 400, { error: 'bad-request' });
      return;
    }
    if (!body || typeof body !== 'object') {
      this.sendJson(res, 400, { error: 'bad-request' });
      return;
    }

    const bodyMindId = (body as { mindId?: unknown }).mindId;
    if (typeof bodyMindId === 'string' && bodyMindId !== tokenMatch.mindId) {
      this.sendJson(res, 403, { error: 'mind-mismatch' });
      return;
    }
    const mindId = tokenMatch.mindId;

    const url = req.url ?? '';
    try {
      if (url === '/prompt') {
        const prompt = (body as { prompt?: unknown }).prompt;
        const recipient = (body as { recipient?: unknown }).recipient;
        if (typeof prompt !== 'string' || prompt.trim() === '') {
          this.sendJson(res, 400, { error: 'prompt-required' });
          return;
        }
        if (recipient !== undefined && typeof recipient !== 'string') {
          this.sendJson(res, 400, { error: 'recipient-invalid' });
          return;
        }
        const result = await this.handlers.onPrompt({ mindId, prompt, recipient });
        this.sendJson(res, 200, result);
        return;
      }
      if (url === '/notify') {
        const title = (body as { title?: unknown }).title;
        const text = (body as { body?: unknown }).body;
        if (typeof title !== 'string' || typeof text !== 'string') {
          this.sendJson(res, 400, { error: 'title-body-required' });
          return;
        }
        await this.handlers.onNotify({ mindId, title, body: text });
        this.sendJson(res, 200, { ok: true });
        return;
      }
      if (url === '/a2a') {
        const recipient = (body as { recipient?: unknown }).recipient;
        const message = (body as { message?: unknown }).message;
        if (typeof recipient !== 'string' || recipient.trim() === '') {
          this.sendJson(res, 400, { error: 'recipient-required' });
          return;
        }
        if (typeof message !== 'string' || message.trim() === '') {
          this.sendJson(res, 400, { error: 'message-required' });
          return;
        }
        if (!this.handlers.onA2a) {
          this.sendJson(res, 501, { error: 'a2a-handler-not-configured' });
          return;
        }
        const contextId = (body as { contextId?: unknown }).contextId;
        const referenceTaskIds = (body as { referenceTaskIds?: unknown }).referenceTaskIds;
        const result = await this.handlers.onA2a({
          mindId,
          recipient,
          message,
          ...(typeof contextId === 'string' ? { contextId } : {}),
          ...(Array.isArray(referenceTaskIds) && referenceTaskIds.every((item) => typeof item === 'string')
            ? { referenceTaskIds }
            : {}),
        });
        this.sendJson(res, 200, result);
        return;
      }
      this.sendJson(res, 404, { error: 'not-found' });
    } catch (err) {
      log.warn(`Bridge handler ${url} failed:`, err);
      const message = err instanceof Error ? err.message : 'handler-failed';
      this.sendJson(res, 502, { error: 'handler-failed', message });
    }
  }

  private sendJson(res: http.ServerResponse, status: number, body: unknown): void {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(body));
  }
}

function isLoopback(address: string): boolean {
  if (!address) return false;
  return (
    address === '127.0.0.1'
    || address === '::1'
    || address === '::ffff:127.0.0.1'
  );
}

async function readJsonBody(req: http.IncomingMessage, maxBytes: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        const err = new Error('body too large') as Error & { code: string };
        err.code = 'BODY_TOO_LARGE';
        req.destroy();
        reject(err);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (total === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}
