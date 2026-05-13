import { describe, it, expect, vi } from 'vitest';
import type {
  CopilotClient,
  CopilotSession,
  SessionConfig,
} from '@github/copilot-sdk';

import { buildOneShotSession } from './oneShotSession';

interface FakeSession {
  sendAndWait: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

interface FakeWorld {
  client: CopilotClient;
  capturedConfig: SessionConfig | undefined;
  session: FakeSession;
}

function makeWorld(overrides: Partial<FakeSession> = {}): FakeWorld {
  const session: FakeSession = {
    sendAndWait: vi.fn().mockResolvedValue({ data: { content: 'pong' } }),
    abort: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  let capturedConfig: SessionConfig | undefined;
  const client = {
    createSession: vi.fn(async (cfg: SessionConfig) => {
      capturedConfig = cfg;
      return session as unknown as CopilotSession;
    }),
  } as unknown as CopilotClient;
  return {
    client,
    get capturedConfig() {
      return capturedConfig;
    },
    session,
  };
}

describe('buildOneShotSession', () => {
  it('creates a session with the locked-down memory-consolidation contract', async () => {
    const world = makeWorld();
    const controller = new AbortController();

    await buildOneShotSession({
      client: world.client,
      workingDirectory: '/tmp/mind-x',
      signal: controller.signal,
    });

    const cfg = world.capturedConfig;
    expect(cfg?.workingDirectory).toBe('/tmp/mind-x');
    expect(cfg?.enableConfigDiscovery).toBe(false);
    expect(cfg?.tools).toEqual([]);
    expect(cfg?.systemMessage).toEqual({ mode: 'replace', content: '' });
    const result = cfg?.onPermissionRequest?.({} as never, {} as never);
    expect(result).toEqual({
      kind: 'reject',
      feedback: 'Tool permissions are disabled for memory-consolidation sessions.',
    });
  });

  it('returns the assistant content from sendAndWait', async () => {
    const world = makeWorld();
    const oneShot = await buildOneShotSession({
      client: world.client,
      workingDirectory: '/tmp/mind-x',
      signal: new AbortController().signal,
    });

    const text = await oneShot.send('hello');

    expect(text).toBe('pong');
    expect(world.session.sendAndWait).toHaveBeenCalledWith({ prompt: 'hello' });
  });

  it('returns empty string when the SDK reports no assistant event', async () => {
    const world = makeWorld({
      sendAndWait: vi.fn().mockResolvedValue(undefined),
    });
    const oneShot = await buildOneShotSession({
      client: world.client,
      workingDirectory: '/tmp/mind-x',
      signal: new AbortController().signal,
    });

    expect(await oneShot.send('hello')).toBe('');
  });

  it('aborts the live session when the caller signal fires', async () => {
    const world = makeWorld();
    const controller = new AbortController();
    await buildOneShotSession({
      client: world.client,
      workingDirectory: '/tmp/mind-x',
      signal: controller.signal,
    });

    expect(world.session.abort).not.toHaveBeenCalled();

    controller.abort();

    expect(world.session.abort).toHaveBeenCalledTimes(1);
  });

  it('aborts immediately when the signal is already aborted', async () => {
    const world = makeWorld();
    const controller = new AbortController();
    controller.abort();

    await buildOneShotSession({
      client: world.client,
      workingDirectory: '/tmp/mind-x',
      signal: controller.signal,
    });

    expect(world.session.abort).toHaveBeenCalledTimes(1);
  });

  it('swallows abort errors so the abort handler cannot crash the daemon', async () => {
    const world = makeWorld({
      abort: vi.fn().mockRejectedValue(new Error('already aborted')),
    });
    const controller = new AbortController();
    await buildOneShotSession({
      client: world.client,
      workingDirectory: '/tmp/mind-x',
      signal: controller.signal,
    });

    expect(() => controller.abort()).not.toThrow();
    await Promise.resolve();
  });

  it('close disconnects the session and removes the abort listener', async () => {
    const world = makeWorld();
    const controller = new AbortController();
    const oneShot = await buildOneShotSession({
      client: world.client,
      workingDirectory: '/tmp/mind-x',
      signal: controller.signal,
    });

    await oneShot.close();
    expect(world.session.disconnect).toHaveBeenCalledTimes(1);

    // Aborting after close must not call session.abort again.
    controller.abort();
    expect(world.session.abort).not.toHaveBeenCalled();
  });

  it('reports disconnect errors via onDisconnectError instead of throwing', async () => {
    const world = makeWorld({
      disconnect: vi.fn().mockRejectedValue(new Error('boom')),
    });
    const reported: unknown[] = [];
    const oneShot = await buildOneShotSession({
      client: world.client,
      workingDirectory: '/tmp/mind-x',
      signal: new AbortController().signal,
      onDisconnectError: (err) => reported.push(err),
    });

    await expect(oneShot.close()).resolves.toBeUndefined();
    expect(reported).toHaveLength(1);
    expect((reported[0] as Error).message).toBe('boom');
  });

  it('swallows disconnect errors silently when no reporter is supplied', async () => {
    const world = makeWorld({
      disconnect: vi.fn().mockRejectedValue(new Error('boom')),
    });
    const oneShot = await buildOneShotSession({
      client: world.client,
      workingDirectory: '/tmp/mind-x',
      signal: new AbortController().signal,
    });

    await expect(oneShot.close()).resolves.toBeUndefined();
  });
});
