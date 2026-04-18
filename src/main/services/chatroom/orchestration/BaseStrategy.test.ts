import { describe, it, expect, vi } from 'vitest';
import { BaseStrategy } from './types';
import type { OrchestrationContext } from './types';
import type { MindContext } from '../../../../shared/types';
import { SequentialStrategy } from './SequentialStrategy';
import { HandoffStrategy } from './HandoffStrategy';
import { GroupChatStrategy } from './GroupChatStrategy';
import { MagenticStrategy } from './MagenticStrategy';

// ---------------------------------------------------------------------------
// Concrete test subclass — exposes protected members for testing
// ---------------------------------------------------------------------------

class TestStrategy extends BaseStrategy {
  readonly mode = 'sequential' as const;

  // Expose protected members for testing
  public callBegin() { return this.begin(); }
  public get testIsAborted() { return this.isAborted; }
  public get testAbortController() { return this.abortController; }
  public get testUnsubs() { return this.currentUnsubs; }
  public set testUnsubs(v: (() => void)[]) { this.currentUnsubs = v; }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async execute(_msg: string, _p: MindContext[], _r: string, _c: OrchestrationContext): Promise<void> {
    // no-op for testing base class
  }
}

describe('BaseStrategy', () => {
  it('begin() creates a fresh AbortController', () => {
    const strategy = new TestStrategy();
    expect(strategy.testAbortController).toBeNull();

    const controller = strategy.callBegin();

    expect(controller).toBeInstanceOf(AbortController);
    expect(strategy.testAbortController).toBe(controller);
    expect(controller.signal.aborted).toBe(false);
  });

  it('isAborted is false before begin()', () => {
    const strategy = new TestStrategy();
    expect(strategy.testIsAborted).toBe(false);
  });

  it('isAborted is false after begin()', () => {
    const strategy = new TestStrategy();
    strategy.callBegin();
    expect(strategy.testIsAborted).toBe(false);
  });

  it('isAborted is true after stop()', () => {
    const strategy = new TestStrategy();
    strategy.callBegin();
    strategy.stop();
    expect(strategy.testIsAborted).toBe(true);
  });

  it('stop() aborts the controller', () => {
    const strategy = new TestStrategy();
    const controller = strategy.callBegin();
    expect(controller.signal.aborted).toBe(false);

    strategy.stop();

    expect(controller.signal.aborted).toBe(true);
  });

  it('stop() calls all unsub functions and clears the array', () => {
    const strategy = new TestStrategy();
    strategy.callBegin();

    const unsub1 = vi.fn();
    const unsub2 = vi.fn();
    const unsub3 = vi.fn();
    strategy.testUnsubs = [unsub1, unsub2, unsub3];

    strategy.stop();

    expect(unsub1).toHaveBeenCalledOnce();
    expect(unsub2).toHaveBeenCalledOnce();
    expect(unsub3).toHaveBeenCalledOnce();
    expect(strategy.testUnsubs).toEqual([]);
  });

  it('stop() is safe to call before begin() (no controller)', () => {
    const strategy = new TestStrategy();
    // Should not throw
    expect(() => strategy.stop()).not.toThrow();
  });

  it('stop() is idempotent — safe to call multiple times', () => {
    const strategy = new TestStrategy();
    strategy.callBegin();
    const unsub = vi.fn();
    strategy.testUnsubs = [unsub];

    strategy.stop();
    strategy.stop();

    // unsub called only once (array was cleared after first stop)
    expect(unsub).toHaveBeenCalledOnce();
  });

  it('begin() replaces previous controller', () => {
    const strategy = new TestStrategy();
    const first = strategy.callBegin();
    const second = strategy.callBegin();

    expect(first).not.toBe(second);
    expect(strategy.testAbortController).toBe(second);
  });
});

// ---------------------------------------------------------------------------
// Inheritance verification — all four strategies extend BaseStrategy
// ---------------------------------------------------------------------------

describe('BaseStrategy inheritance', () => {
  it('SequentialStrategy inherits stop() from BaseStrategy', () => {
    const strategy = new SequentialStrategy();
    expect(strategy).toBeInstanceOf(BaseStrategy);
    expect(strategy.stop).toBe(BaseStrategy.prototype.stop);
  });

  it('HandoffStrategy inherits stop() from BaseStrategy', () => {
    const strategy = new HandoffStrategy({ maxHandoffHops: 5 });
    expect(strategy).toBeInstanceOf(BaseStrategy);
    expect(strategy.stop).toBe(BaseStrategy.prototype.stop);
  });

  it('GroupChatStrategy inherits stop() from BaseStrategy', () => {
    const strategy = new GroupChatStrategy({
      moderatorMindId: 'mod',
      maxTurns: 10,
      minRounds: 1,
      maxSpeakerRepeats: 3,
    });
    expect(strategy).toBeInstanceOf(BaseStrategy);
    expect(strategy.stop).toBe(BaseStrategy.prototype.stop);
  });

  it('MagenticStrategy inherits stop() from BaseStrategy', () => {
    const strategy = new MagenticStrategy({
      managerMindId: 'mgr',
      maxSteps: 10,
    });
    expect(strategy).toBeInstanceOf(BaseStrategy);
    expect(strategy.stop).toBe(BaseStrategy.prototype.stop);
  });
});
