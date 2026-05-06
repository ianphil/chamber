import { describe, it, expect, vi } from 'vitest';
import type { OrchestrationStrategy, OrchestrationContext } from '../../chatroom/orchestration';
import { wrapStrategy } from './wrap-strategy';
import { SessionGroup } from '../SessionGroup';
import type { SessionGroupRunContext, ProductHooks } from './types';
import type { SessionGroupSessionFactory } from '../types';
import type { PermissionHandler } from '@github/copilot-sdk';
import type { CopilotSession } from '../../mind';
import type { ChatroomMessage } from '@chamber/shared/chatroom-types';
import type { MindContext } from '@chamber/shared/types';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function fakeSession(): CopilotSession {
  return {
    abort: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
  } as unknown as CopilotSession;
}

function fakeFactory(): SessionGroupSessionFactory {
  return {
    createChatroomSession: vi.fn(async () => fakeSession()),
  };
}

function fakeProduct(): ProductHooks {
  return {
    buildBasePrompt: vi.fn(() => 'prompt'),
    emitEvent: vi.fn(),
    persistMessage: vi.fn(),
    getHistory: vi.fn(() => [] as ChatroomMessage[]),
  };
}

const noopPermissionFactory = () =>
  (async () => ({ kind: 'approve-once' as const })) as PermissionHandler;

const mind: MindContext = {
  mindId: 'dude',
  mindPath: '/minds/dude',
  identity: { name: 'Dude', systemMessage: 'I am Dude' },
  status: 'ready',
};

// ---------------------------------------------------------------------------
// wrapStrategy
// ---------------------------------------------------------------------------

describe('wrapStrategy', () => {
  it('forwards mode and exposes execute / stop', () => {
    const strategy: OrchestrationStrategy = {
      mode: 'concurrent',
      execute: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
    };

    const wrapped = wrapStrategy(strategy);

    expect(wrapped.mode).toBe('concurrent');
    wrapped.stop();
    expect(strategy.stop).toHaveBeenCalledTimes(1);
  });

  it('rebuilds an OrchestrationContext where session lifecycle routes through SessionGroup', async () => {
    const factory = fakeFactory();
    const group = new SessionGroup(factory, noopPermissionFactory);
    const evictSpy = vi.spyOn(group, 'evictSession');
    const getSpy = vi.spyOn(group, 'getOrCreateSession');

    let captured: OrchestrationContext | undefined;
    const strategy: OrchestrationStrategy = {
      mode: 'sequential',
      execute: vi.fn(async (_msg, _parts, _round, ctx) => { captured = ctx; }),
      stop: vi.fn(),
    };

    const product = fakeProduct();
    const runContext: SessionGroupRunContext = { group, product, orchestrationMode: 'sequential' };

    await wrapStrategy(strategy).execute('hi', [mind], 'r1', runContext);

    if (!captured) throw new Error('expected ctx');
    const ctx = captured;

    await ctx.getOrCreateSession('dude');
    expect(getSpy).toHaveBeenCalledWith('dude');

    ctx.evictSession('dude');
    expect(evictSpy).toHaveBeenCalledWith('dude');

    expect(ctx.orchestrationMode).toBe('sequential');
    expect(ctx.buildBasePrompt).toBe(product.buildBasePrompt);
    expect(ctx.emitEvent).toBe(product.emitEvent);
    expect(ctx.persistMessage).toBe(product.persistMessage);
    expect(ctx.getHistory).toBe(product.getHistory);
  });
});

// ---------------------------------------------------------------------------
// SessionGroup.run / stopActiveRun
// ---------------------------------------------------------------------------

describe('SessionGroup.run', () => {
  it('invokes the orchestrator with a run context bound to the group', async () => {
    const group = new SessionGroup(fakeFactory(), noopPermissionFactory);
    const product = fakeProduct();

    let received: SessionGroupRunContext | undefined;
    const orchestrator = {
      mode: 'concurrent' as const,
      execute: vi.fn(async (_p, _ps, _r, ctx: SessionGroupRunContext) => { received = ctx; }),
      stop: vi.fn(),
    };

    await group.run({
      prompt: 'hi',
      participants: [mind],
      roundId: 'r1',
      orchestrator,
      product,
    });

    expect(orchestrator.execute).toHaveBeenCalledTimes(1);
    if (!received) throw new Error('expected runContext');
    expect(received.group).toBe(group);
    expect(received.product).toBe(product);
    expect(received.orchestrationMode).toBe('concurrent');
    expect(group.isRunning).toBe(false);
  });

  it('clears activeOrchestrator when execute throws', async () => {
    const group = new SessionGroup(fakeFactory(), noopPermissionFactory);
    const orchestrator = {
      mode: 'concurrent' as const,
      execute: vi.fn(async () => { throw new Error('boom'); }),
      stop: vi.fn(),
    };

    await expect(group.run({
      prompt: 'hi',
      participants: [],
      roundId: 'r1',
      orchestrator,
      product: fakeProduct(),
    })).rejects.toThrow('boom');

    expect(group.isRunning).toBe(false);
  });

  it('marks isRunning while execute is in flight', async () => {
    const group = new SessionGroup(fakeFactory(), noopPermissionFactory);
    let resolveExec: (() => void) | undefined;
    const orchestrator = {
      mode: 'sequential' as const,
      execute: vi.fn(() => new Promise<void>((res) => { resolveExec = res; })),
      stop: vi.fn(),
    };

    const runPromise = group.run({
      prompt: 'hi',
      participants: [mind],
      roundId: 'r1',
      orchestrator,
      product: fakeProduct(),
    });

    // Yield once so the orchestrator's execute has started.
    await Promise.resolve();
    expect(group.isRunning).toBe(true);

    resolveExec?.();
    await runPromise;
    expect(group.isRunning).toBe(false);
  });
});

describe('SessionGroup.stopActiveRun', () => {
  it('calls stop on the active orchestrator and clears it', async () => {
    const group = new SessionGroup(fakeFactory(), noopPermissionFactory);
    let resolveExec: (() => void) | undefined;
    const orchestrator = {
      mode: 'sequential' as const,
      execute: vi.fn(() => new Promise<void>((res) => { resolveExec = res; })),
      stop: vi.fn(() => { resolveExec?.(); }),
    };

    const runPromise = group.run({
      prompt: 'hi',
      participants: [mind],
      roundId: 'r1',
      orchestrator,
      product: fakeProduct(),
    });
    await Promise.resolve();

    group.stopActiveRun();
    await runPromise;

    expect(orchestrator.stop).toHaveBeenCalledTimes(1);
    expect(group.isRunning).toBe(false);
  });

  it('is a no-op when no orchestrator is active', () => {
    const group = new SessionGroup(fakeFactory(), noopPermissionFactory);
    expect(() => group.stopActiveRun()).not.toThrow();
  });
});
