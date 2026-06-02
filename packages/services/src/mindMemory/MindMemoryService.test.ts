/**
 * MindMemoryService — Phase 11.
 *
 * Lifecycle + public surface for per-mind background memory consolidation.
 * Wires the InternalScheduler entry, opens dream.db, builds the vault /
 * archive / daemon, and registers a TurnCompletionObserver on ChatService
 * (whose `onTurnCompleted` forwards to the per-mind DailyLogWriter).
 *
 * Strict opt-in: when `.chamber.json → workingMemory.consolidation.enabled`
 * is not exactly `true`, activate is a no-op (no db open, no factories
 * called beyond configReader, no observer registered).
 *
 * Documented choice: a second `activateMind` for the same mindId while
 * already activated is a no-op (idempotent — never replaces collaborators
 * mid-flight). Callers must `releaseMind` first to swap configuration.
 */

import path from 'node:path';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';

import type { TurnCompletionObserver, CompletedTurn } from '@chamber/shared/turn-observer';

import { createMindMemoryService } from './MindMemoryService';
import type {
  ChatObserverRegistry,
  MindMemoryServiceFactories,
} from './MindMemoryService';
import type { DreamDaemon, DreamRunResult } from './DreamDaemon';
import type { InternalScheduler, RegisterOptions } from './InternalScheduler';
import type { MindMemoryVault } from './MindMemoryVault';
import type { MindArchiveStore } from './MindArchiveStore';
import type { ChamberMindConfig } from '../mind/chamberMindConfig';
import { dreamDbPath } from './dream-schema';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function makeFakeScheduler(): InternalScheduler & {
  readonly registered: Map<string, RegisterOptions>;
  readonly closeCalls: number;
} {
  const registered = new Map<string, RegisterOptions>();
  let closeCalls = 0;
  const scheduler = {
    register(opts: RegisterOptions): void {
      registered.set(opts.mindId, opts);
    },
    unregister(mindId: string): void {
      registered.delete(mindId);
    },
    async runNow(mindId: string): Promise<void> {
      const entry = registered.get(mindId);
      if (!entry) throw new Error(`unknown ${mindId}`);
      await entry.fn();
    },
    list(): ReadonlyMap<string, string> {
      const m = new Map<string, string>();
      for (const [k, v] of registered) m.set(k, v.cronExpr);
      return m;
    },
    close(): void {
      closeCalls += 1;
      registered.clear();
    },
    get registered() {
      return registered;
    },
    get closeCalls() {
      return closeCalls;
    },
  };
  return scheduler;
}

function makeFakeDb(): Database.Database & { closed: boolean } {
  let closed = false;
  // Only the methods MindMemoryService cares about. The rest are stubs that
  // throw if accidentally invoked.
  const db = {
    close: vi.fn(() => {
      closed = true;
    }),
    get closed() {
      return closed;
    },
  };
  return db as unknown as Database.Database & { closed: boolean };
}

function makeFakeVault(root: string): MindMemoryVault {
  return {
    root,
    read: vi.fn(async () => null),
    write: vi.fn(async () => undefined),
    append: vi.fn(async () => undefined),
    exists: vi.fn(async () => false),
    listFiles: vi.fn(async () => []),
    ensureDir: vi.fn(async () => undefined),
  };
}

function makeFakeArchive(root: string): MindArchiveStore {
  return {
    root,
    writeConsolidated: vi.fn(async () => 'consolidated/x.md'),
    writeWeekly: vi.fn(async () => 'weekly/x.md'),
    writeMonthly: vi.fn(async () => 'monthly/x.md'),
    listConsolidated: vi.fn(async () => []),
    listWeekly: vi.fn(async () => []),
    listMonthly: vi.fn(async () => []),
  };
}

function makeFakeDaemon(): DreamDaemon & { runCalls: number; closeCalls: number } {
  let runCalls = 0;
  let closeCalls = 0;
  const daemon: DreamDaemon = {
    async run(): Promise<DreamRunResult> {
      runCalls += 1;
      return { status: 'skipped', reason: 'no-turns' };
    },
    async forceRun(): Promise<DreamRunResult> {
      return { status: 'skipped', reason: 'no-turns' };
    },
    getStatus() {
      return { phase: 'idle', locked: false, lastRunAt: null, lastResult: null };
    },
    notifyTurnCompleted() {
      /* no-op */
    },
    async close(): Promise<void> {
      closeCalls += 1;
    },
  };
  return Object.defineProperties(daemon, {
    runCalls: { get: () => runCalls, enumerable: true },
    closeCalls: { get: () => closeCalls, enumerable: true },
  }) as DreamDaemon & { runCalls: number; closeCalls: number };
}

function makeFakeChat(): ChatObserverRegistry & {
  readonly observers: TurnCompletionObserver[];
} {
  const observers: TurnCompletionObserver[] = [];
  return {
    addObserver(o: TurnCompletionObserver): void {
      observers.push(o);
    },
    removeObserver(o: TurnCompletionObserver): void {
      const i = observers.indexOf(o);
      if (i !== -1) observers.splice(i, 1);
    },
    get observers() {
      return observers;
    },
  };
}

interface FactoryCallLog {
  readonly events: string[];
}

function makeFactories(args: {
  readonly chamberConfig: ChamberMindConfig;
  readonly daemon?: DreamDaemon;
  readonly daemonError?: Error;
  readonly dbError?: Error;
  readonly vaultError?: Error;
  readonly archiveError?: Error;
  readonly chat?: ChatObserverRegistry;
  readonly scheduler?: ReturnType<typeof makeFakeScheduler>;
  readonly schedulerRegisterError?: Error;
}): {
  readonly factories: MindMemoryServiceFactories;
  readonly log: FactoryCallLog;
  readonly db: ReturnType<typeof makeFakeDb>;
  readonly vault: MindMemoryVault;
  readonly archive: MindArchiveStore;
  readonly daemon: DreamDaemon;
  readonly chat: ReturnType<typeof makeFakeChat>;
  readonly scheduler: ReturnType<typeof makeFakeScheduler>;
} {
  const events: string[] = [];
  const db = makeFakeDb();
  const vault = makeFakeVault('/tmp/vault');
  const archive = makeFakeArchive('/tmp/archive');
  const daemon = (args.daemon ?? makeFakeDaemon()) as ReturnType<typeof makeFakeDaemon>;
  const chat = (args.chat ?? makeFakeChat()) as ReturnType<typeof makeFakeChat>;
  const scheduler = args.scheduler ?? makeFakeScheduler();

  if (args.schedulerRegisterError) {
    const baseRegister = scheduler.register.bind(scheduler);
    void baseRegister;
    scheduler.register = (() => {
      events.push('scheduler.register');
      throw args.schedulerRegisterError;
    }) as InternalScheduler['register'];
  } else {
    const baseRegister = scheduler.register.bind(scheduler);
    scheduler.register = ((opts: RegisterOptions) => {
      events.push('scheduler.register');
      baseRegister(opts);
    }) as InternalScheduler['register'];
  }

  const factories: MindMemoryServiceFactories = {
    scheduler,
    chatService: chat,
    configReader: vi.fn((mindPath: string) => {
      events.push(`configReader:${mindPath}`);
      return args.chamberConfig;
    }),
    dbFactory: vi.fn((dbPath: string) => {
      events.push(`dbFactory:${dbPath}`);
      if (args.dbError) throw args.dbError;
      return db;
    }),
    vaultFactory: vi.fn((mindPath: string) => {
      events.push(`vaultFactory:${mindPath}`);
      if (args.vaultError) throw args.vaultError;
      return vault;
    }),
    archiveFactory: vi.fn((mindPath: string) => {
      events.push(`archiveFactory:${mindPath}`);
      if (args.archiveError) throw args.archiveError;
      return archive;
    }),
    daemonFactory: vi.fn(() => {
      events.push('daemonFactory');
      if (args.daemonError) throw args.daemonError;
      return daemon;
    }),
  };

  return { factories, log: { events }, db, vault, archive, daemon, chat, scheduler };
}

const ENABLED_CONFIG: ChamberMindConfig = {
  workingMemory: {
    consolidation: {
      enabled: true,
      cron: '0 3 * * *',
      lastKTurns: 10,
      perTurnMaxBytes: 2048,
      memoryMaxBytes: 8192,
    },
  },
};

const DISABLED_CONFIG: ChamberMindConfig = {
  workingMemory: {
    consolidation: {
      enabled: false,
      cron: '0 3 * * *',
      lastKTurns: 10,
      perTurnMaxBytes: 2048,
      memoryMaxBytes: 8192,
    },
  },
};

const MIND_PATH = path.join('/', 'tmp', 'mind-alpha');
const MIND_ID = 'mind-alpha';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MindMemoryService — activateMind: opt-in honored', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns early when consolidation.enabled is false — no factories beyond configReader, no observer registered', async () => {
    const { factories, log, chat, scheduler } = makeFactories({ chamberConfig: DISABLED_CONFIG });
    const svc = createMindMemoryService(factories);

    await svc.activateMind(MIND_ID, MIND_PATH);

    expect(log.events).toEqual([`configReader:${MIND_PATH}`]);
    expect(factories.dbFactory).not.toHaveBeenCalled();
    expect(factories.vaultFactory).not.toHaveBeenCalled();
    expect(factories.archiveFactory).not.toHaveBeenCalled();
    expect(factories.daemonFactory).not.toHaveBeenCalled();
    expect(chat.observers).toHaveLength(0);
    expect(scheduler.registered.size).toBe(0);
  });

  it('treats a truthy-but-not-true enabled value as disabled (defensive against config drift)', async () => {
    const odd: ChamberMindConfig = {
      workingMemory: {
        consolidation: {
          ...ENABLED_CONFIG.workingMemory.consolidation,
          // Force a non-`true` truthy value past the type system.
          enabled: 1 as unknown as boolean,
        },
      },
    };
    const { factories, chat, scheduler } = makeFactories({ chamberConfig: odd });
    const svc = createMindMemoryService(factories);

    await svc.activateMind(MIND_ID, MIND_PATH);

    expect(factories.dbFactory).not.toHaveBeenCalled();
    expect(chat.observers).toHaveLength(0);
    expect(scheduler.registered.size).toBe(0);
  });
});

describe('MindMemoryService — activateMind: enabled path wires everything', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens dream.db at <mindPath>/.working-memory/.state/dream.db, builds vault/archive/daemon, registers scheduler, adds observer', async () => {
    const { factories, log, db, vault, archive, daemon, chat, scheduler } = makeFactories({
      chamberConfig: ENABLED_CONFIG,
    });
    const svc = createMindMemoryService(factories);

    await svc.activateMind(MIND_ID, MIND_PATH);

    // Order: config → vault/archive (independent) → db → daemon → scheduler → observer.
    // Strict ordering only matters where one collaborator depends on another:
    // db must be opened before daemonFactory (which receives it); scheduler
    // entry / observer registration come last so a daemonFactory failure
    // doesn't leak a registered cron or observer.
    const idxConfig = log.events.indexOf(`configReader:${MIND_PATH}`);
    const idxDb = log.events.indexOf(`dbFactory:${dreamDbPath(MIND_PATH)}`);
    const idxDaemon = log.events.indexOf('daemonFactory');
    const idxRegister = log.events.indexOf('scheduler.register');
    expect(idxConfig).toBeGreaterThanOrEqual(0);
    expect(idxDb).toBeGreaterThan(idxConfig);
    expect(idxDaemon).toBeGreaterThan(idxDb);
    expect(idxRegister).toBeGreaterThan(idxDaemon);

    expect(factories.vaultFactory).toHaveBeenCalledWith(MIND_PATH);
    expect(factories.archiveFactory).toHaveBeenCalledWith(MIND_PATH);
    expect(factories.daemonFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        mindId: MIND_ID,
        mindPath: MIND_PATH,
        vault,
        archive,
        db,
        config: ENABLED_CONFIG.workingMemory.consolidation,
      }),
    );

    // Scheduler entry: cron from config, jitter 30s, fn drives daemon.run.
    const entry = scheduler.registered.get(MIND_ID);
    expect(entry).toBeDefined();
    expect(entry!.cronExpr).toBe('0 3 * * *');
    expect(entry!.jitterMs).toBe(30_000);
    await entry!.fn();
    expect((daemon as ReturnType<typeof makeFakeDaemon>).runCalls).toBe(1);

    // Exactly one observer added.
    expect(chat.observers).toHaveLength(1);
    expect(typeof chat.observers[0].onTurnCompleted).toBe('function');
  });

  it('observer forwards onTurnCompleted to the per-mind DailyLogWriter without throwing across the boundary', async () => {
    const { factories, chat } = makeFactories({ chamberConfig: ENABLED_CONFIG });
    const svc = createMindMemoryService(factories);
    await svc.activateMind(MIND_ID, MIND_PATH);

    const obs = chat.observers[0];
    const turn: CompletedTurn = {
      turnId: 't1',
      sessionId: 's1',
      model: 'm',
      status: 'completed',
      startedAt: '2026-05-12T00:00:00.000Z',
      endedAt: '2026-05-12T00:00:01.000Z',
      prompt: 'hi',
      finalAssistantMessage: 'hello',
    };

    // We don't actually want to touch the filesystem here; just verify the
    // observer is callable and returns a thenable. The real DailyLogWriter
    // is exercised by its own tests. Construction-only test for wiring.
    const result = obs.onTurnCompleted(turn);
    expect(result === undefined || typeof (result as Promise<void>).then === 'function').toBe(true);
  });
});

describe('MindMemoryService — DailyLogWriter onTurnRecorded → dream-state activity counter', () => {
  // INVARIANT (real bug fixed in Phase 14): the writer constructed inside
  // `activateMind` must wire `onTurnRecorded` so each completed turn bumps
  // `dream_state.turns_since_last_run`. Without this, the daemon's activity
  // gate would block consolidation forever (default `minTurnsBetweenRuns: 1`).
  // We exercise the wiring against a real :memory: better-sqlite3 db + real
  // MindMemoryVault on disk so the assertion is end-to-end.
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('observer.onTurnCompleted increments turns_since_last_run via DailyLogWriter onTurnRecorded', async () => {
    const { mkdtempSync, rmSync, mkdirSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { createRequire } = await import('node:module');
    const { createMindMemoryVault } = await import('./MindMemoryVault');
    const { createMindArchiveStore } = await import('./MindArchiveStore');
    const { migrate } = await import('./dream-schema');
    const { readState } = await import('./dream-state');

    const runtimeRequire = createRequire(__filename);
    const Database = runtimeRequire('better-sqlite3') as typeof import('better-sqlite3');

    const root = mkdtempSync(path.join(tmpdir(), 'chamber-mindmem-onturn-'));
    const mindPath = path.join(root, 'mind-real');
    mkdirSync(mindPath, { recursive: true });

    const realDb = new Database(':memory:');
    migrate(realDb);

    const chat = makeFakeChat();
    const scheduler = makeFakeScheduler();
    const daemon = makeFakeDaemon();

    const factories: MindMemoryServiceFactories = {
      scheduler,
      chatService: chat,
      configReader: () => ENABLED_CONFIG,
      dbFactory: () => realDb as unknown as Database.Database,
      vaultFactory: createMindMemoryVault,
      archiveFactory: createMindArchiveStore,
      daemonFactory: () => daemon,
    };

    const svc = createMindMemoryService(factories);
    try {
      await svc.activateMind(MIND_ID, mindPath);

      expect(readState(realDb).turnsSinceLastRun).toBe(0);

      const obs = chat.observers[0];
      const t1: CompletedTurn = {
        turnId: 't-1',
        sessionId: 's-1',
        model: 'm',
        status: 'completed',
        startedAt: '2026-05-12T00:00:00.000Z',
        endedAt: '2026-05-12T00:00:01.000Z',
        prompt: 'hi',
        finalAssistantMessage: 'hello',
      };
      const t2: CompletedTurn = { ...t1, turnId: 't-2' };

      await obs.onTurnCompleted(t1);
      await obs.onTurnCompleted(t2);

      expect(readState(realDb).turnsSinceLastRun).toBe(2);

      await svc.releaseMind(MIND_ID);
    } finally {
      try {
        if (realDb.open) realDb.close();
      } catch {
        /* noop */
      }
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('MindMemoryService — activateMind: idempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('second activate for the same already-activated mind is a no-op (documented choice)', async () => {
    const { factories, chat, scheduler } = makeFactories({ chamberConfig: ENABLED_CONFIG });
    const svc = createMindMemoryService(factories);

    await svc.activateMind(MIND_ID, MIND_PATH);
    const dbCalls = (factories.dbFactory as ReturnType<typeof vi.fn>).mock.calls.length;
    const daemonCalls = (factories.daemonFactory as ReturnType<typeof vi.fn>).mock.calls.length;
    const obsCount = chat.observers.length;
    const schedSize = scheduler.registered.size;

    await svc.activateMind(MIND_ID, MIND_PATH);

    expect((factories.dbFactory as ReturnType<typeof vi.fn>).mock.calls.length).toBe(dbCalls);
    expect((factories.daemonFactory as ReturnType<typeof vi.fn>).mock.calls.length).toBe(daemonCalls);
    expect(chat.observers).toHaveLength(obsCount);
    expect(scheduler.registered.size).toBe(schedSize);
  });

  it('after release, a subsequent activate rebuilds the entry', async () => {
    const { factories, chat, scheduler } = makeFactories({ chamberConfig: ENABLED_CONFIG });
    const svc = createMindMemoryService(factories);

    await svc.activateMind(MIND_ID, MIND_PATH);
    await svc.releaseMind(MIND_ID);
    await svc.activateMind(MIND_ID, MIND_PATH);

    expect((factories.dbFactory as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
    expect((factories.daemonFactory as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
    expect(chat.observers).toHaveLength(1);
    expect(scheduler.registered.size).toBe(1);
  });
});

describe('MindMemoryService — releaseMind', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('tears down everything: scheduler.unregister, observer removed, daemon.close, db.close', async () => {
    const { factories, db, daemon, chat, scheduler } = makeFactories({ chamberConfig: ENABLED_CONFIG });
    const svc = createMindMemoryService(factories);

    await svc.activateMind(MIND_ID, MIND_PATH);
    expect(chat.observers).toHaveLength(1);
    expect(scheduler.registered.size).toBe(1);

    await svc.releaseMind(MIND_ID);

    expect(scheduler.registered.has(MIND_ID)).toBe(false);
    expect(chat.observers).toHaveLength(0);
    expect((daemon as ReturnType<typeof makeFakeDaemon>).closeCalls).toBe(1);
    expect((db as ReturnType<typeof makeFakeDb>).closed).toBe(true);
  });

  it('release of an unknown mind is a no-op', async () => {
    const { factories, scheduler } = makeFactories({ chamberConfig: ENABLED_CONFIG });
    const svc = createMindMemoryService(factories);

    await expect(svc.releaseMind('never-activated')).resolves.toBeUndefined();
    expect(scheduler.registered.size).toBe(0);
  });

  it('release of a mind that opted out (activate was a no-op) is also a no-op', async () => {
    const { factories, scheduler } = makeFactories({ chamberConfig: DISABLED_CONFIG });
    const svc = createMindMemoryService(factories);
    await svc.activateMind(MIND_ID, MIND_PATH);
    await expect(svc.releaseMind(MIND_ID)).resolves.toBeUndefined();
    expect(scheduler.registered.size).toBe(0);
  });

  it('release is idempotent — second release of the same mind does not throw or double-close', async () => {
    const { factories, db, daemon } = makeFactories({ chamberConfig: ENABLED_CONFIG });
    const svc = createMindMemoryService(factories);
    await svc.activateMind(MIND_ID, MIND_PATH);
    await svc.releaseMind(MIND_ID);
    await expect(svc.releaseMind(MIND_ID)).resolves.toBeUndefined();
    expect((daemon as ReturnType<typeof makeFakeDaemon>).closeCalls).toBe(1);
    expect((db as ReturnType<typeof makeFakeDb>).closed).toBe(true);
  });
});

describe('MindMemoryService — close()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('releases every activated mind sequentially', async () => {
    const { factories, chat, scheduler } = makeFactories({ chamberConfig: ENABLED_CONFIG });
    const svc = createMindMemoryService(factories);

    await svc.activateMind('m1', '/tmp/m1');
    await svc.activateMind('m2', '/tmp/m2');
    expect(chat.observers).toHaveLength(2);
    expect(scheduler.registered.size).toBe(2);

    await svc.close();

    expect(chat.observers).toHaveLength(0);
    expect(scheduler.registered.size).toBe(0);
  });

  it('is idempotent', async () => {
    const { factories } = makeFactories({ chamberConfig: ENABLED_CONFIG });
    const svc = createMindMemoryService(factories);
    await svc.activateMind(MIND_ID, MIND_PATH);
    await svc.close();
    await expect(svc.close()).resolves.toBeUndefined();
  });

  it('after close, further activate calls are rejected (fail-fast — keeps lifecycle invariant clear)', async () => {
    const { factories } = makeFactories({ chamberConfig: ENABLED_CONFIG });
    const svc = createMindMemoryService(factories);
    await svc.close();
    await expect(svc.activateMind(MIND_ID, MIND_PATH)).rejects.toThrow(/closed/i);
  });
});

describe('MindMemoryService — activation error rollback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('daemonFactory throws → db is closed, scheduler not registered, observer not added, mind not tracked', async () => {
    const { factories, db, chat, scheduler } = makeFactories({
      chamberConfig: ENABLED_CONFIG,
      daemonError: new Error('daemon boom'),
    });
    const svc = createMindMemoryService(factories);

    await expect(svc.activateMind(MIND_ID, MIND_PATH)).rejects.toThrow('daemon boom');

    expect((db as ReturnType<typeof makeFakeDb>).closed).toBe(true);
    expect(scheduler.registered.size).toBe(0);
    expect(chat.observers).toHaveLength(0);

    // Mind is NOT tracked, so a follow-up release is a no-op AND a follow-up
    // activate (after fixing the failure) re-attempts the full build.
    await expect(svc.releaseMind(MIND_ID)).resolves.toBeUndefined();
  });

  it('scheduler.register throws → daemon is closed, db is closed, observer not added, mind not tracked', async () => {
    const { factories, db, daemon, chat, scheduler } = makeFactories({
      chamberConfig: ENABLED_CONFIG,
      schedulerRegisterError: new Error('cron boom'),
    });
    const svc = createMindMemoryService(factories);

    await expect(svc.activateMind(MIND_ID, MIND_PATH)).rejects.toThrow('cron boom');

    expect((daemon as ReturnType<typeof makeFakeDaemon>).closeCalls).toBe(1);
    expect((db as ReturnType<typeof makeFakeDb>).closed).toBe(true);
    expect(scheduler.registered.size).toBe(0);
    expect(chat.observers).toHaveLength(0);
  });

  it('dbFactory throws → no other factories called, mind not tracked', async () => {
    const { factories, chat, scheduler } = makeFactories({
      chamberConfig: ENABLED_CONFIG,
      dbError: new Error('db boom'),
    });
    const svc = createMindMemoryService(factories);

    await expect(svc.activateMind(MIND_ID, MIND_PATH)).rejects.toThrow('db boom');

    expect(factories.daemonFactory).not.toHaveBeenCalled();
    expect(scheduler.registered.size).toBe(0);
    expect(chat.observers).toHaveLength(0);
  });
});

describe('MindMemoryService — multi-mind isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('release of one mind does not disturb another activated mind', async () => {
    const { factories, chat, scheduler } = makeFactories({ chamberConfig: ENABLED_CONFIG });
    const svc = createMindMemoryService(factories);

    await svc.activateMind('m1', '/tmp/m1');
    await svc.activateMind('m2', '/tmp/m2');
    await svc.releaseMind('m1');

    expect(scheduler.registered.has('m1')).toBe(false);
    expect(scheduler.registered.has('m2')).toBe(true);
    expect(chat.observers).toHaveLength(1);
  });
});

describe('MindMemoryService — __debugGet (E2E accessor)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null for an unknown mind id', () => {
    const { factories } = makeFactories({ chamberConfig: ENABLED_CONFIG });
    const svc = createMindMemoryService(factories);

    expect(svc.__debugGet('does-not-exist')).toBeNull();
  });

  it('returns null for a disabled mind (activate was a no-op)', async () => {
    const { factories } = makeFactories({ chamberConfig: DISABLED_CONFIG });
    const svc = createMindMemoryService(factories);

    await svc.activateMind(MIND_ID, MIND_PATH);

    expect(svc.__debugGet(MIND_ID)).toBeNull();
  });

  it('returns the live daemon + dbPath for an activated mind', async () => {
    const { factories, daemon } = makeFactories({ chamberConfig: ENABLED_CONFIG });
    const svc = createMindMemoryService(factories);

    await svc.activateMind(MIND_ID, MIND_PATH);

    const entry = svc.__debugGet(MIND_ID);
    expect(entry).not.toBeNull();
    expect(entry!.daemon).toBe(daemon);
    expect(entry!.dbPath).toBe(dreamDbPath(MIND_PATH));
    expect(entry!.writer).toBeDefined();
    expect(typeof entry!.writer.write).toBe('function');
  });

  it('returns null again after releaseMind', async () => {
    const { factories } = makeFactories({ chamberConfig: ENABLED_CONFIG });
    const svc = createMindMemoryService(factories);

    await svc.activateMind(MIND_ID, MIND_PATH);
    expect(svc.__debugGet(MIND_ID)).not.toBeNull();

    await svc.releaseMind(MIND_ID);
    expect(svc.__debugGet(MIND_ID)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// v0.60.0 — Eager migration on activate (Phase 1)
//
// When a mind that was previously opted-out flips to opted-in, the user
// experience is "I clicked the switch and now my old freeform log is
// preserved as log.legacy.md and a fresh structured log was seeded". This
// must happen WITHOUT requiring a turn to land — otherwise the user sees no
// effect until they next chat with the mind, and the "what happens to my
// log" question stays scary.
//
// Implementation contract: `activateMind` for an opted-in mind invokes
// `writer.migrateIfNeeded()` BEFORE returning. Opted-out mind: never called
// (no writer is constructed at all per the strict-opt-in contract).
//
// Tests use a real filesystem because the writer is built inline inside
// `activateMind` (no writerFactory injection). The observable contract is
// log.md state after activate resolves.
// ---------------------------------------------------------------------------

describe('MindMemoryService — activateMind: eager migration (Phase 1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opted-in mind with pre-existing unstructured log.md → after activate, log.md is sentinel-only and log.legacy.md preserves the original', async () => {
    const { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { STRUCTURED_LOG_SENTINEL } = await import('./StructuredLogFormat');

    const root = mkdtempSync(path.join(tmpdir(), 'chamber-mindmem-migrate-'));
    const mindPath = path.join(root, 'mind-real');
    const wmDir = path.join(mindPath, '.working-memory');
    mkdirSync(wmDir, { recursive: true });

    const original = '# legacy freeform notes\nrandom content\n';
    writeFileSync(path.join(wmDir, 'log.md'), original);

    const { factories } = makeFactories({ chamberConfig: ENABLED_CONFIG });
    const svc = createMindMemoryService(factories);
    try {
      await svc.activateMind(MIND_ID, mindPath);

      // Original content rotated out of the way.
      expect(existsSync(path.join(wmDir, 'log.legacy.md'))).toBe(true);
      expect(readFileSync(path.join(wmDir, 'log.legacy.md'), 'utf-8')).toBe(original);

      // log.md is sentinel-only (NO turn frame — migration ran before any turns).
      expect(readFileSync(path.join(wmDir, 'log.md'), 'utf-8')).toBe(
        STRUCTURED_LOG_SENTINEL + '\n\n',
      );

      await svc.releaseMind(MIND_ID);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('opted-in mind with sentinel log.md → activate is a no-op for migration (idempotent)', async () => {
    const { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { STRUCTURED_LOG_SENTINEL } = await import('./StructuredLogFormat');

    const root = mkdtempSync(path.join(tmpdir(), 'chamber-mindmem-migrate-noop-'));
    const mindPath = path.join(root, 'mind-real');
    const wmDir = path.join(mindPath, '.working-memory');
    mkdirSync(wmDir, { recursive: true });

    const sentinelOnly = STRUCTURED_LOG_SENTINEL + '\n\n';
    writeFileSync(path.join(wmDir, 'log.md'), sentinelOnly);

    const { factories } = makeFactories({ chamberConfig: ENABLED_CONFIG });
    const svc = createMindMemoryService(factories);
    try {
      await svc.activateMind(MIND_ID, mindPath);

      expect(existsSync(path.join(wmDir, 'log.legacy.md'))).toBe(false);
      expect(readFileSync(path.join(wmDir, 'log.md'), 'utf-8')).toBe(sentinelOnly);

      await svc.releaseMind(MIND_ID);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('opted-out mind with pre-existing unstructured log.md → activate does NOT touch log.md (no migration, no rotation)', async () => {
    const { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');

    const root = mkdtempSync(path.join(tmpdir(), 'chamber-mindmem-migrate-disabled-'));
    const mindPath = path.join(root, 'mind-real');
    const wmDir = path.join(mindPath, '.working-memory');
    mkdirSync(wmDir, { recursive: true });

    const original = '# legacy freeform notes\nrandom content\n';
    writeFileSync(path.join(wmDir, 'log.md'), original);

    const { factories } = makeFactories({ chamberConfig: DISABLED_CONFIG });
    const svc = createMindMemoryService(factories);
    try {
      await svc.activateMind(MIND_ID, mindPath);

      // Untouched.
      expect(existsSync(path.join(wmDir, 'log.legacy.md'))).toBe(false);
      expect(readFileSync(path.join(wmDir, 'log.md'), 'utf-8')).toBe(original);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('opted-in mind with no log.md → activate creates the directory but does NOT seed log.md (migrateIfNeeded is a no-op for missing files)', async () => {
    const { mkdtempSync, rmSync, mkdirSync, existsSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');

    const root = mkdtempSync(path.join(tmpdir(), 'chamber-mindmem-migrate-empty-'));
    const mindPath = path.join(root, 'mind-real');
    mkdirSync(mindPath, { recursive: true });

    const { factories } = makeFactories({ chamberConfig: ENABLED_CONFIG });
    const svc = createMindMemoryService(factories);
    try {
      await svc.activateMind(MIND_ID, mindPath);

      // migrateIfNeeded is a no-op when log.md does not exist. The first
      // write() will seed the sentinel — until then, log.md stays absent.
      expect(existsSync(path.join(mindPath, '.working-memory', 'log.md'))).toBe(false);

      await svc.releaseMind(MIND_ID);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// v0.60.0 — Per-mindId activate/release serialization (Uncle Bob finding 2)
//
// `main.ts` wires MindManager events to MindMemoryService via fire-and-forget
// `.catch()` chains. A user who rapid-toggles the daemon switch (ON → OFF →
// ON within a few hundred ms) generates back-to-back activate/release calls
// that may interleave: activate#1 → release while activate#1 still running →
// activate#2 sees `active.has(mindId)` and no-ops.
//
// The fix: serialize per-mindId inside MindMemoryService so the second
// activate genuinely runs after the release completes. The composition root
// stays simple (still fire-and-forget); the service owns the invariant.
// ---------------------------------------------------------------------------

describe('MindMemoryService — per-mindId activate/release serialization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rapid activate → release → activate for the same mindId all complete and end with the mind activated', async () => {
    const { factories, chat, scheduler } = makeFactories({ chamberConfig: ENABLED_CONFIG });
    const svc = createMindMemoryService(factories);

    // Fire all three without awaiting between them — exactly the pattern
    // main.ts's fire-and-forget event handlers produce on rapid toggle.
    const p1 = svc.activateMind(MIND_ID, MIND_PATH);
    const p2 = svc.releaseMind(MIND_ID);
    const p3 = svc.activateMind(MIND_ID, MIND_PATH);

    await Promise.all([p1, p2, p3]);

    // End state: mind is activated exactly once.
    expect(scheduler.registered.size).toBe(1);
    expect(chat.observers).toHaveLength(1);
    // dbFactory called twice (once per activate); daemonFactory called twice.
    expect((factories.dbFactory as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
    expect((factories.daemonFactory as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  it('rapid release → activate (when not active) for the same mindId end with the mind activated', async () => {
    const { factories, chat, scheduler } = makeFactories({ chamberConfig: ENABLED_CONFIG });
    const svc = createMindMemoryService(factories);

    const p1 = svc.releaseMind(MIND_ID); // no-op (not active yet)
    const p2 = svc.activateMind(MIND_ID, MIND_PATH);

    await Promise.all([p1, p2]);

    expect(scheduler.registered.size).toBe(1);
    expect(chat.observers).toHaveLength(1);
  });

  it('serialization is per-mindId — independent minds run in parallel', async () => {
    const { factories, chat, scheduler } = makeFactories({ chamberConfig: ENABLED_CONFIG });
    const svc = createMindMemoryService(factories);

    await Promise.all([
      svc.activateMind('mind-a', '/tmp/mind-a'),
      svc.activateMind('mind-b', '/tmp/mind-b'),
      svc.activateMind('mind-c', '/tmp/mind-c'),
    ]);

    expect(scheduler.registered.size).toBe(3);
    expect(chat.observers).toHaveLength(3);
  });
});
