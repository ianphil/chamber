import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_MAX_CRASHES_BEFORE_CIRCUIT_BREAK,
  WtdRuntimeProcess,
  type WtdRuntimeProcessOptions,
} from './WtdRuntimeProcess';
import type { WtdRuntimePaths } from './runtimeResolution';

const PATHS: WtdRuntimePaths = {
  nodeBinary: 'C:\\resources\\node\\node.exe',
  hostPath: 'C:\\resources\\wtd-runtime\\host.mjs',
  wtdEntry: 'C:\\resources\\wtd-runtime\\node_modules\\@ianphil\\ttasks-wtd\\dist\\index.js',
  onnxBinding: 'C:\\resources\\wtd-runtime\\node_modules\\onnxruntime-node\\bin\\napi-v6\\win32\\x64\\onnxruntime_binding.node',
};

class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly sent: unknown[] = [];
  readonly send = vi.fn((message: unknown) => {
    this.sent.push(message);
  });

  readonly kill = vi.fn(() => true);

  emitExit(code: number | null): void {
    this.emit('exit', code);
  }
}

function createHarness(overrides: Partial<WtdRuntimeProcessOptions> = {}) {
  const children: FakeChild[] = [];
  const forkFn = vi.fn(() => {
    const child = new FakeChild();
    children.push(child);
    return child as unknown as ReturnType<typeof import('node:child_process').fork>;
  });

  const runtime = new WtdRuntimeProcess({
    cacheDir: 'C:\\cache\\wtd-mixed-v1',
    resolveRuntime: () => PATHS,
    forkFn: forkFn as unknown as typeof import('node:child_process').fork,
    initTimeoutMs: 200,
    retrieveTimeoutMs: 200,
    ...overrides,
  });

  return { runtime, children, forkFn };
}

function respondInitialized(child: FakeChild, overrides: Partial<{ cacheHit: boolean; packageVersion: string; revision: string }> = {}): void {
  const requestId = (child.sent[0] as { requestId: string }).requestId;
  child.emit('message', {
    type: 'initialized',
    requestId,
    cacheHit: overrides.cacheHit ?? true,
    packageVersion: overrides.packageVersion ?? '0.1.0',
    revision: overrides.revision ?? 'v0.4.3',
  });
}

function respondRetrieved(child: FakeChild, result: Record<string, unknown>): void {
  const requestMessage = child.sent[child.sent.length - 1] as { requestId: string; type: string };
  child.emit('message', { type: 'retrieved', requestId: requestMessage.requestId, result });
}

// Resolving the initialize IPC round-trip and re-entering retrieve() involves
// several chained microtasks (message handler -> pending promise -> async
// function continuations -> initPromise.finally -> caller's await). A
// macrotask tick (unlike a fixed number of `await Promise.resolve()` calls)
// reliably drains all of them regardless of how deep the chain is.
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('WtdRuntimeProcess', () => {
  it('spawns the resolved host with the resolved node binary and wtd entry', async () => {
    const { runtime, children, forkFn } = createHarness();
    const initPromise = runtime.initialize();
    respondInitialized(children[0]);
    await initPromise;

    expect(forkFn).toHaveBeenCalledTimes(1);
    expect(forkFn).toHaveBeenCalledWith(
      PATHS.hostPath,
      [PATHS.wtdEntry],
      expect.objectContaining({ execPath: PATHS.nodeBinary, silent: true }),
    );
    expect(children[0].sent[0]).toMatchObject({ type: 'initialize', cacheDir: 'C:\\cache\\wtd-mixed-v1' });
  });

  it('validates and sends a retrieve request, merging packageVersion/revision/cacheHit into the result', async () => {
    const { runtime, children } = createHarness();
    const retrievePromise = runtime.retrieve({ query: 'fix branches and verify' });

    await tick();
    respondInitialized(children[0]);
    await tick();

    respondRetrieved(children[0], {
      queryKind: 'text',
      querySummary: 'fix branches and verify',
      candidates: [{ name: 'linear', description: 'd', score: 1, nodeCount: 2, edgeCount: 1, guidance: 'g' }],
    });

    const result = await retrievePromise;
    expect(result.packageVersion).toBe('0.1.0');
    expect(result.revision).toBe('v0.4.3');
    expect(result.cacheHit).toBe(true);
    expect(result.candidates).toHaveLength(1);

    const retrieveMessage = children[0].sent.find((message) => (message as { type: string }).type === 'retrieve') as Record<string, unknown>;
    expect(retrieveMessage).toMatchObject({ query: 'fix branches and verify', k: 5, mode: 'auto' });
  });

  it('rejects an invalid k without spawning a retrieve message', async () => {
    const { runtime, children } = createHarness();

    await expect(runtime.retrieve({ query: 'plan', k: 6 })).rejects.toThrow(/integer between 1 and 5/);
    await expect(runtime.retrieve({ query: 'plan', mode: 'bogus' as never })).rejects.toThrow(/auto, structural, metadata/);
    await expect(runtime.retrieve({})).rejects.toThrow(/requires a query and\/or a draftDag/);
    expect(children).toHaveLength(0);
  });

  it('rejects an oversized compact draft DAG before sending', async () => {
    const { runtime } = createHarness();
    const steps = Array.from({ length: 65 }, (_, index) => `step ${index}`);

    await expect(runtime.retrieve({ draftDag: { steps } })).rejects.toThrow(/exceeds the maximum of 64 steps/);
  });

  it('retries once transparently when the first retrieve attempt fails', async () => {
    const { runtime, children } = createHarness();
    const retrievePromise = runtime.retrieve({ query: 'fix branches and verify' });

    await tick();
    respondInitialized(children[0]);
    await tick();

    // First retrieve attempt: simulate a host crash.
    children[0].emitExit(1);
    await tick();

    // Retry re-initializes a second child.
    respondInitialized(children[1]);
    await tick();
    respondRetrieved(children[1], {
      queryKind: 'text',
      querySummary: 'fix branches and verify',
      candidates: [],
    });

    const result = await retrievePromise;
    expect(result.queryKind).toBe('text');
    expect(children).toHaveLength(2);
  });

  it('opens a circuit breaker after repeated crashes for the rest of the app session', async () => {
    const { runtime, children } = createHarness({ maxCrashesBeforeCircuitBreak: DEFAULT_MAX_CRASHES_BEFORE_CIRCUIT_BREAK });

    for (let attempt = 0; attempt < DEFAULT_MAX_CRASHES_BEFORE_CIRCUIT_BREAK; attempt += 1) {
      const initPromise = runtime.initialize();
      await Promise.resolve();
      await Promise.resolve();
      children[attempt].emitExit(1);
      await expect(initPromise).rejects.toThrow();
    }

    await expect(runtime.initialize()).rejects.toThrow(/circuit breaker is open/);
    await new Promise((resolve) => setTimeout(resolve, 75));
    await expect(runtime.initialize()).rejects.toThrow(/rest of this app session/);
    expect(children).toHaveLength(DEFAULT_MAX_CRASHES_BEFORE_CIRCUIT_BREAK);
  });

  it('sends shutdown and resolves once the child exits', async () => {
    const { runtime, children } = createHarness();
    const initPromise = runtime.initialize();
    respondInitialized(children[0]);
    await initPromise;

    const stopPromise = runtime.stop();
    expect(children[0].send).toHaveBeenCalledWith({ type: 'shutdown' });
    children[0].emitExit(0);
    await stopPromise;
  });

  it('times out an initialize call that never responds', async () => {
    const { runtime } = createHarness({ initTimeoutMs: 20 });
    await expect(runtime.initialize()).rejects.toThrow(/timed out waiting for "initialize"/);
  });

  it('never logs the raw query or draftDag contents', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const { runtime, children } = createHarness();
      const secretQuery = 'super-secret-workflow-query-token';
      const retrievePromise = runtime.retrieve({ query: secretQuery });

      await tick();
      respondInitialized(children[0]);
      await tick();
      respondRetrieved(children[0], { queryKind: 'text', querySummary: 'redacted', candidates: [] });
      await retrievePromise;

      const allLoggedArgs = [...logSpy.mock.calls, ...warnSpy.mock.calls].flat();
      expect(allLoggedArgs.some((arg) => typeof arg === 'string' && arg.includes(secretQuery))).toBe(false);
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});
