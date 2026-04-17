import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { WebSocket } from 'ws';
import { z } from 'zod';

import { startRpcSidecar, type RpcSidecarHandle } from './wsServer';
import { Dispatcher } from './dispatcher';
import { PushBus } from './pushBus';
import { JSON_RPC_ERROR } from './jsonRpc';

type Frame = Record<string, unknown>;

function connect(port: number): WebSocket {
  return new WebSocket(`ws://127.0.0.1:${port}`);
}

function ready(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
}

/** Send a JSON-RPC request and wait for the matching response by id. */
function rpc(socket: WebSocket, id: number | string, method: string, params?: unknown[]): Promise<Frame> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: WebSocket.RawData) => {
      const frame = JSON.parse(data.toString('utf8')) as Frame;
      if (frame.id === id) {
        socket.off('message', onMessage);
        resolve(frame);
      }
    };
    socket.on('message', onMessage);
    socket.once('error', reject);
    socket.send(
      JSON.stringify(
        params === undefined
          ? { jsonrpc: '2.0', id, method }
          : { jsonrpc: '2.0', id, method, params },
      ),
    );
  });
}

/** Collect every frame on this socket for `ms` milliseconds. */
function collect(socket: WebSocket, ms: number): Promise<Frame[]> {
  return new Promise((resolve) => {
    const frames: Frame[] = [];
    const onMessage = (data: WebSocket.RawData) => {
      frames.push(JSON.parse(data.toString('utf8')) as Frame);
    };
    socket.on('message', onMessage);
    setTimeout(() => {
      socket.off('message', onMessage);
      resolve(frames);
    }, ms);
  });
}

describe('startRpcSidecar', () => {
  let handle: RpcSidecarHandle | undefined;
  let tmpDir: string | undefined;
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const s of sockets.splice(0)) {
      try {
        s.close();
      } catch {
        /* ignore */
      }
    }
    if (handle) {
      await handle.close();
      handle = undefined;
    }
    if (tmpDir) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      tmpDir = undefined;
    }
  });

  async function boot() {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-rpc-'));
    const dispatcher = new Dispatcher();
    const pushBus = new PushBus();
    handle = await startRpcSidecar({
      dispatcher,
      pushBus,
      portFileDir: tmpDir,
      logError: () => undefined, // silence expected-error noise in tests
    });
    return { dispatcher, pushBus, handle };
  }

  it('binds to a free loopback port and writes rpc-port.json atomically', async () => {
    const { handle: h } = await boot();
    expect(h.port).toBeGreaterThan(0);
    const contents = JSON.parse(fs.readFileSync(h.portFilePath, 'utf8'));
    expect(contents.port).toBe(h.port);
    expect(contents.pid).toBe(process.pid);
    expect(contents.host).toBe('127.0.0.1');
  });

  it('deletes rpc-port.json on close', async () => {
    const { handle: h } = await boot();
    expect(fs.existsSync(h.portFilePath)).toBe(true);
    await h.close();
    handle = undefined;
    expect(fs.existsSync(h.portFilePath)).toBe(false);
  });

  it('dispatches a valid request and returns the result', async () => {
    const { dispatcher, handle: h } = await boot();
    dispatcher.register('echo', z.tuple([z.string()]), async ([s]) => `echo:${s}`);

    const socket = connect(h.port);
    sockets.push(socket);
    await ready(socket);
    const frame = await rpc(socket, 1, 'echo', ['hi']);
    expect(frame).toEqual({ jsonrpc: '2.0', id: 1, result: 'echo:hi' });
  });

  it('returns -32601 METHOD_NOT_FOUND for unknown methods', async () => {
    const { handle: h } = await boot();
    const socket = connect(h.port);
    sockets.push(socket);
    await ready(socket);
    const frame = await rpc(socket, 2, 'nope', []);
    expect(frame.id).toBe(2);
    expect((frame.error as { code: number }).code).toBe(JSON_RPC_ERROR.METHOD_NOT_FOUND);
  });

  it('returns -32601 for electron-only channels over WS', async () => {
    const { dispatcher, handle: h } = await boot();
    // mind:selectDirectory is classified electron-only.
    dispatcher.register('mind:selectDirectory', z.tuple([]), async () => ({ path: '/x' }));
    const socket = connect(h.port);
    sockets.push(socket);
    await ready(socket);
    const frame = await rpc(socket, 3, 'mind:selectDirectory', []);
    const errObj = frame.error as { code: number; data?: { channel: string } };
    expect(errObj.code).toBe(JSON_RPC_ERROR.METHOD_NOT_FOUND);
    expect(errObj.data?.channel).toBe('mind:selectDirectory');
  });

  it('returns -32601 for a2a:* channels over WS (ws-unsupported pending codec)', async () => {
    const { dispatcher, handle: h } = await boot();
    dispatcher.register('a2a:listAgents', z.tuple([]), async () => []);
    const socket = connect(h.port);
    sockets.push(socket);
    await ready(socket);
    const frame = await rpc(socket, 31, 'a2a:listAgents', []);
    const errObj = frame.error as { code: number; data?: { channel: string } };
    expect(errObj.code).toBe(JSON_RPC_ERROR.METHOD_NOT_FOUND);
    expect(errObj.data?.channel).toBe('a2a:listAgents');
  });

  it('returns -32602 INVALID_PARAMS with sanitized issues on schema failure', async () => {
    const { dispatcher, handle: h } = await boot();
    dispatcher.register('strict', z.tuple([z.string()]), async ([s]) => s);
    const socket = connect(h.port);
    sockets.push(socket);
    await ready(socket);
    const frame = await rpc(socket, 4, 'strict', [42]);
    const errObj = frame.error as { code: number; data?: { channel: string; issues: unknown[] } };
    expect(errObj.code).toBe(JSON_RPC_ERROR.INVALID_PARAMS);
    expect(errObj.data?.channel).toBe('strict');
    expect(Array.isArray(errObj.data?.issues)).toBe(true);
    expect((errObj.data?.issues ?? []).length).toBeGreaterThan(0);
  });

  it('returns -32602 when params is not an array (named params unsupported)', async () => {
    const { dispatcher, handle: h } = await boot();
    dispatcher.register('x', z.tuple([]), async () => 1);
    const socket = connect(h.port);
    sockets.push(socket);
    await ready(socket);
    socket.send(JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'x', params: { a: 1 } }));
    const frames = await collect(socket, 80);
    const match = frames.find((f) => f.id === 5);
    expect((match?.error as { code: number }).code).toBe(JSON_RPC_ERROR.INVALID_PARAMS);
  });

  it('returns -32603 INTERNAL_ERROR with a sanitized message on handler throw', async () => {
    const { dispatcher, handle: h } = await boot();
    dispatcher.register('boom', z.tuple([]), async () => {
      const e = new Error('inner message');
      (e as { stack?: string }).stack = 'SENSITIVE STACK\n    at secret.ts:42';
      throw e;
    });
    const socket = connect(h.port);
    sockets.push(socket);
    await ready(socket);
    const frame = await rpc(socket, 6, 'boom', []);
    const errObj = frame.error as { code: number; message: string; data?: unknown };
    expect(errObj.code).toBe(JSON_RPC_ERROR.INTERNAL_ERROR);
    expect(errObj.message).toBe('inner message');
    // No stack leaks through the wire.
    expect(JSON.stringify(frame)).not.toContain('SENSITIVE STACK');
    expect(JSON.stringify(frame)).not.toContain('secret.ts');
  });

  it('returns -32700 PARSE_ERROR for malformed JSON', async () => {
    const { handle: h } = await boot();
    const socket = connect(h.port);
    sockets.push(socket);
    await ready(socket);
    socket.send('not json');
    const frames = await collect(socket, 80);
    expect(frames.length).toBeGreaterThan(0);
    expect((frames[0].error as { code: number }).code).toBe(JSON_RPC_ERROR.PARSE_ERROR);
  });

  it('routes caller-scoped reply.emit via notifications on the same socket', async () => {
    const { dispatcher, handle: h } = await boot();
    dispatcher.register('chat:send', z.tuple([z.string()]), async ([s], ctx) => {
      ctx.reply.emit('chat:event', { text: s });
      return 'ok';
    });
    const a = connect(h.port);
    const b = connect(h.port);
    sockets.push(a, b);
    await Promise.all([ready(a), ready(b)]);

    const bFramesPromise = collect(b, 150);
    const aFramesPromise = collect(a, 150);
    a.send(JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'chat:send', params: ['hi'] }));
    const [aFrames, bFrames] = await Promise.all([aFramesPromise, bFramesPromise]);

    // a sees result AND the notification
    expect(aFrames.some((f) => f.id === 7)).toBe(true);
    expect(aFrames.some((f) => f.method === 'chat:event')).toBe(true);
    // b sees NEITHER (reply-scope)
    expect(bFrames.some((f) => f.method === 'chat:event')).toBe(false);
  });

  it('broadcasts pushBus publishes to every connected socket', async () => {
    const { pushBus, handle: h } = await boot();
    const a = connect(h.port);
    const b = connect(h.port);
    sockets.push(a, b);
    await Promise.all([ready(a), ready(b)]);

    const aFramesPromise = collect(a, 150);
    const bFramesPromise = collect(b, 150);
    pushBus.publish('mind:changed', { minds: [{ id: 'x' }] });
    const [aFrames, bFrames] = await Promise.all([aFramesPromise, bFramesPromise]);

    const isMindChanged = (f: Frame) => f.method === 'mind:changed';
    expect(aFrames.some(isMindChanged)).toBe(true);
    expect(bFrames.some(isMindChanged)).toBe(true);
  });

  it('notifications (id omitted) do not receive a response', async () => {
    const { dispatcher, handle: h } = await boot();
    let called = false;
    dispatcher.register('tick', z.tuple([]), async () => {
      called = true;
      return 0;
    });
    const socket = connect(h.port);
    sockets.push(socket);
    await ready(socket);
    const framesPromise = collect(socket, 120);
    socket.send(JSON.stringify({ jsonrpc: '2.0', method: 'tick' }));
    const frames = await framesPromise;
    expect(frames).toEqual([]);
    expect(called).toBe(true);
  });

  it('unsubscribes pushBus on close — no more broadcasts', async () => {
    const { pushBus, handle: h } = await boot();
    expect(pushBus.subscriberCount).toBe(1);
    await h.close();
    handle = undefined;
    expect(pushBus.subscriberCount).toBe(0);
  });
});
