import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { URL } from 'node:url';
import type { CanvasAction, CanvasServerLike } from './types';

const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

interface CanvasServerOptions {
  resolveContentDir: (mindId: string) => string | null;
  onAction: (action: CanvasAction) => void;
  authorizeRequest: (mindId: string, filename: string, token: string | null) => boolean;
}

type CanvasClient = ServerResponse<IncomingMessage>;

const CHAMBER_CANVAS_STYLE = `
<style>
:root {
  color-scheme: dark;
  --ch-background: oklch(0.145 0.008 260);
  --ch-foreground: oklch(0.985 0 0);
  --ch-card: oklch(0.195 0.015 260);
  --ch-border: oklch(0.25 0.012 260);
  --ch-muted: oklch(0.255 0.015 260);
  --ch-muted-foreground: oklch(0.708 0.01 260);
  --ch-accent: oklch(0.255 0.015 260);
  --ch-genesis: oklch(0.72 0.15 160);
  --ch-radius: 0.75rem;
  --ch-font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
  --ch-font-mono: "JetBrains Mono", ui-monospace, monospace;
}
* { box-sizing: border-box; }
html, body { min-height: 100%; }
body {
  margin: 0;
  background: var(--ch-background);
  color: var(--ch-foreground);
  font-family: var(--ch-font-sans);
}
.ch-page { min-height: 100vh; padding: 1.5rem; background: var(--ch-background); color: var(--ch-foreground); }
.ch-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); gap: 1rem; }
.ch-card { border: 1px solid var(--ch-border); border-radius: var(--ch-radius); background: var(--ch-card); padding: 1rem; }
.ch-muted { color: var(--ch-muted-foreground); }
.ch-button, .ch-button-secondary {
  border: 0;
  border-radius: 0.5rem;
  cursor: pointer;
  font: inherit;
  padding: 0.5rem 0.75rem;
}
.ch-button { background: var(--ch-foreground); color: var(--ch-background); }
.ch-button-secondary { background: var(--ch-muted); color: var(--ch-foreground); }
.ch-input {
  width: 100%;
  border: 1px solid var(--ch-border);
  border-radius: 0.5rem;
  background: var(--ch-muted);
  color: var(--ch-foreground);
  font: inherit;
  padding: 0.5rem 0.75rem;
}
.ch-table { width: 100%; border-collapse: collapse; }
.ch-table th, .ch-table td { border-bottom: 1px solid var(--ch-border); padding: 0.625rem; text-align: left; }
.ch-badge { border: 1px solid var(--ch-border); border-radius: 999px; display: inline-flex; padding: 0.125rem 0.5rem; color: var(--ch-muted-foreground); }
</style>`;

function buildBridgeScript(filename: string): string {
  return `
<script>
(function() {
  var canvasFile = ${JSON.stringify(filename)};
  var canvasToken = new URLSearchParams(location.search).get('token') || '';
  var es = new EventSource('_sse?canvas=' + encodeURIComponent(canvasFile) + '&token=' + encodeURIComponent(canvasToken));
  es.onmessage = function(e) {
    if (e.data === 'reload') { location.reload(); }
    if (e.data === 'close') { window.close(); }
  };

  window.canvas = {
    sendAction: function(name, data) {
      return fetch('_action?canvas=' + encodeURIComponent(canvasFile) + '&token=' + encodeURIComponent(canvasToken), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: name, data: data || {}, timestamp: Date.now() })
      });
    }
  };
})();
</script>`;
}

function injectBridge(html: string, filename: string): string {
  const bridgeScript = buildBridgeScript(filename);
  const additions = `${CHAMBER_CANVAS_STYLE}\n${bridgeScript}`;
  if (html.includes('</head>')) {
    const withStyle = html.replace('</head>', `${CHAMBER_CANVAS_STYLE}\n</head>`);
    if (withStyle.includes('</body>')) {
      return withStyle.replace('</body>', `${bridgeScript}\n</body>`);
    }
    return `${withStyle}${bridgeScript}`;
  }
  if (html.includes('</body>')) {
    return html.replace('</body>', `${additions}\n</body>`);
  }
  if (html.includes('</html>')) {
    return html.replace('</html>', `${additions}\n</html>`);
  }
  return `${html}${additions}`;
}

function normalizePath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isPathInside(parent: string, child: string): boolean {
  const normalizedParent = normalizePath(parent);
  const normalizedChild = normalizePath(child);
  return normalizedChild === normalizedParent || normalizedChild.startsWith(`${normalizedParent}${path.sep}`);
}

function readRequestBody(req: IncomingMessage, maxBytes = 64 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      bytes += Buffer.byteLength(chunk, 'utf8');
      if (bytes > maxBytes) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

export class CanvasServer implements CanvasServerLike {
  private server: Server | null = null;
  private port: number | null = null;
  private readonly sseClients = new Map<string, Set<CanvasClient>>();

  constructor(private readonly options: CanvasServerOptions) {}

  async start(): Promise<number> {
    if (this.server) {
      if (this.port === null) {
        throw new Error('Canvas server is running without a bound port');
      }
      return this.port;
    }

    return new Promise<number>((resolve, reject) => {
      const server = createServer((req, res) => {
        void this.handleRequest(req, res);
      });

      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Canvas server failed to bind to a TCP port'));
          return;
        }

        this.server = server;
        this.port = address.port;
        resolve(address.port);
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    const server = this.server;
    this.closeClients();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    this.server = null;
    this.port = null;
    this.sseClients.clear();
  }

  reload(mindId?: string, filename?: string): void {
    this.broadcast('reload', mindId, filename);
  }

  closeClients(mindId?: string, filename?: string): void {
    const entries = this.matchingClientEntries(mindId, filename);
    for (const [key, clients] of entries) {
      for (const client of clients) {
        try {
          client.write('data: close\n\n');
          client.end();
        } catch {
          // Ignore client disconnect races during close.
        }
      }
      this.sseClients.delete(key);
    }
  }

  getPort(): number | null {
    return this.port;
  }

  isRunning(): boolean {
    return this.server !== null;
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
    const segments = requestUrl.pathname.split('/').filter(Boolean).map(decodeURIComponent);

    if (segments.length === 0) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const [mindId, ...rest] = segments;
    if (!mindId) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    if (rest.length === 1 && rest[0] === '_sse') {
      this.handleSse(req, res, mindId, requestUrl.searchParams.get('canvas'), requestUrl.searchParams.get('token'));
      return;
    }

    if (rest.length === 1 && rest[0] === '_action') {
      await this.handleAction(req, res, mindId, requestUrl.searchParams.get('canvas'), requestUrl.searchParams.get('token'));
      return;
    }

    this.handleStaticFile(res, mindId, rest, requestUrl.searchParams.get('token'));
  }

  private handleSse(req: IncomingMessage, res: ServerResponse, mindId: string, filename: string | null, token: string | null): void {
    if (!filename) {
      res.writeHead(400);
      res.end('Missing canvas query parameter');
      return;
    }
    if (!this.options.authorizeRequest(mindId, filename, token)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    res.writeHead(200, {
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream',
    });
    res.write('data: connected\n\n');

    this.addClient(mindId, filename, res);
    req.on('close', () => {
      this.removeClient(mindId, filename, res);
    });
  }

  private async handleAction(req: IncomingMessage, res: ServerResponse, mindId: string, filename: string | null, token: string | null): Promise<void> {
    if (!filename) {
      res.writeHead(400);
      res.end('{"error":"missing canvas"}');
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end('{"error":"method not allowed"}');
      return;
    }
    if (!this.options.authorizeRequest(mindId, filename, token)) {
      res.writeHead(403);
      res.end('{"error":"forbidden"}');
      return;
    }
    if (!String(req.headers['content-type'] ?? '').toLowerCase().includes('application/json')) {
      res.writeHead(415);
      res.end('{"error":"unsupported media type"}');
      return;
    }

    try {
      const body = await readRequestBody(req);
      const parsed = JSON.parse(body) as Record<string, unknown>;
      this.options.onAction({
        mindId,
        canvas: filename,
        action: typeof parsed.action === 'string' ? parsed.action : 'unknown',
        data: parsed.data,
        timestamp: typeof parsed.timestamp === 'number' ? parsed.timestamp : Date.now(),
      });
      res.writeHead(200, {
        'Content-Type': 'application/json',
      });
      res.end('{"ok":true}');
    } catch {
      res.writeHead(400);
      res.end('{"error":"invalid json"}');
    }
  }

  private handleStaticFile(res: ServerResponse, mindId: string, segments: string[], token: string | null): void {
    const contentDir = this.options.resolveContentDir(mindId);
    if (!contentDir) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const relativePath = segments.length === 0 ? 'index.html' : path.join(...segments);
    const fullPath = path.resolve(contentDir, relativePath);
    if (!isPathInside(contentDir, fullPath)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    const normalizedRelativePath = relativePath.replace(/\\/g, '/');
    if (!this.options.authorizeRequest(mindId, normalizedRelativePath, token)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    try {
      let content: Buffer | string = fs.readFileSync(fullPath);
      const extension = path.extname(fullPath).toLowerCase();
      const mimeType = MIME_TYPES[extension] ?? 'application/octet-stream';

      if (extension === '.html') {
        content = injectBridge(content.toString('utf8'), normalizedRelativePath);
      }

      res.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': mimeType,
      });
      res.end(content);
    } catch {
      res.writeHead(500);
      res.end('Server error');
    }
  }

  private broadcast(message: 'reload' | 'close', mindId?: string, filename?: string): void {
    const entries = this.matchingClientEntries(mindId, filename);
    for (const [, clients] of entries) {
      for (const client of clients) {
        try {
          client.write(`data: ${message}\n\n`);
        } catch {
          // Ignore client disconnect races during broadcast.
        }
      }
    }
  }

  private addClient(mindId: string, filename: string, client: CanvasClient): void {
    const key = this.clientKey(mindId, filename);
    const clients = this.sseClients.get(key) ?? new Set<CanvasClient>();
    clients.add(client);
    this.sseClients.set(key, clients);
  }

  private removeClient(mindId: string, filename: string, client: CanvasClient): void {
    const key = this.clientKey(mindId, filename);
    const clients = this.sseClients.get(key);
    if (!clients) {
      return;
    }

    clients.delete(client);
    if (clients.size === 0) {
      this.sseClients.delete(key);
    }
  }

  private matchingClientEntries(mindId?: string, filename?: string): Array<[string, Set<CanvasClient>]> {
    if (mindId && filename) {
      const clients = this.sseClients.get(this.clientKey(mindId, filename));
      return clients ? [[this.clientKey(mindId, filename), clients]] : [];
    }

    if (mindId) {
      const prefix = `${mindId}:`;
      return [...this.sseClients.entries()].filter(([key]) => key.startsWith(prefix));
    }

    return [...this.sseClients.entries()];
  }

  private clientKey(mindId: string, filename: string): string {
    return `${mindId}:${filename}`;
  }
}
