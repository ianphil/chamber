import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasServer } from './CanvasServer';

const tempDirs: string[] = [];

function makeMindDir(name = 'mind-1'): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-canvas-server-'));
  const mindDir = path.join(root, name);
  fs.mkdirSync(mindDir, { recursive: true });
  tempDirs.push(root);
  return mindDir;
}

async function readChunk(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<{ done: boolean; text: string }> {
  const { done, value } = await reader.read();
  return {
    done,
    text: value ? new TextDecoder().decode(value) : '',
  };
}

describe('CanvasServer', () => {
  let server: CanvasServer;
  const mindDirs = new Map<string, string>();
  const tokens = new Map<string, string>();
  const onAction = vi.fn();

  beforeEach(() => {
    mindDirs.clear();
    tokens.clear();
    onAction.mockReset();
    server = new CanvasServer({
      resolveContentDir: (mindId) => mindDirs.get(mindId) ?? null,
      onAction,
      authorizeRequest: (mindId, filename, token) => tokens.get(`${mindId}:${filename}`) === token,
    });
  });

  afterEach(async () => {
    await server.stop();
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir && fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('serves html with the bridge script injected', async () => {
    const mindDir = makeMindDir();
    mindDirs.set('mind-1', mindDir);
    fs.writeFileSync(
      path.join(mindDir, 'report.html'),
      '<!DOCTYPE html><html><body><h1>Hello</h1></body></html>',
      'utf8',
    );
    tokens.set('mind-1:report.html', 'secret-token');

    const port = await server.start();
    const response = await fetch(`http://127.0.0.1:${port}/mind-1/report.html?token=secret-token`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('--ch-background');
    expect(html).toContain('.ch-card');
    expect(html).toContain("new URLSearchParams(location.search).get('token')");
    expect(html).toContain("new EventSource('_sse?canvas=' + encodeURIComponent(canvasFile) + '&token='");
    expect(html).toContain("fetch('_action?canvas=' + encodeURIComponent(canvasFile) + '&token='");
  });

  it('supports targeted reload and close events over SSE', async () => {
    const mindDir = makeMindDir();
    mindDirs.set('mind-1', mindDir);
    tokens.set('mind-1:report.html', 'secret-token');
    fs.writeFileSync(path.join(mindDir, 'report.html'), '<html><body>Hi</body></html>', 'utf8');

    const port = await server.start();
    const response = await fetch(`http://127.0.0.1:${port}/mind-1/_sse?canvas=report.html&token=secret-token`);
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Expected SSE response body');
    }

    const first = await readChunk(reader);
    expect(first.text).toContain('connected');

    server.reload('mind-1', 'report.html');
    const second = await readChunk(reader);
    expect(second.text).toContain('reload');

    server.closeClients('mind-1', 'report.html');
    const third = await readChunk(reader);
    expect(third.text).toContain('close');

    const fourth = await readChunk(reader);
    expect(fourth.done).toBe(true);
  });

  it('routes browser actions back to the callback', async () => {
    const mindDir = makeMindDir();
    mindDirs.set('mind-1', mindDir);
    tokens.set('mind-1:report.html', 'secret-token');

    const port = await server.start();
    const response = await fetch(`http://127.0.0.1:${port}/mind-1/_action?canvas=report.html&token=secret-token`, {
      body: JSON.stringify({
        action: 'button-clicked',
        data: { id: 'approve' },
        timestamp: 123,
      }),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"ok":true}');
    expect(onAction).toHaveBeenCalledWith({
      action: 'button-clicked',
      canvas: 'report.html',
      data: { id: 'approve' },
      mindId: 'mind-1',
      timestamp: 123,
    });
  });

  it('rejects Canvas actions without the canvas token', async () => {
    const mindDir = makeMindDir();
    mindDirs.set('mind-1', mindDir);
    tokens.set('mind-1:report.html', 'secret-token');

    const port = await server.start();
    const response = await fetch(`http://127.0.0.1:${port}/mind-1/_action?canvas=report.html`, {
      body: JSON.stringify({ action: 'button-clicked' }),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    });

    expect(response.status).toBe(403);
    expect(onAction).not.toHaveBeenCalled();
  });

  it('rejects path traversal outside the mind content directory', async () => {
    const mindDir = makeMindDir();
    mindDirs.set('mind-1', mindDir);

    const port = await server.start();
    const response = await fetch(`http://127.0.0.1:${port}/mind-1/..%2Fsecret.txt`);

    expect(response.status).toBe(403);
    expect(await response.text()).toBe('Forbidden');
  });
});
