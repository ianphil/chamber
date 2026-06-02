/**
 * Phase 13 composition smoke for MindMemoryService.
 *
 * Goal: catch native-module / DI failures cheaply, without launching
 * Electron. Builds the full service graph against a tmpdir mindPath using:
 *   - real `createInternalScheduler`
 *   - real `createMindMemoryVault` / `createMindArchiveStore`
 *   - real `defaultConfigReader` (.chamber.json on disk)
 *   - real better-sqlite3 dbFactory at <mindPath>/.working-memory/.state/dream.db
 *   - a fake daemon factory + chat-observer registry (the real DreamDaemon
 *     needs a CopilotClient, which needs Electron — out of scope for a
 *     non-Electron smoke).
 *
 * The expensive integration that exercises the real CopilotLLMClient lives
 * in Phase 14.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  createMindMemoryService,
  createInternalScheduler,
  createMindMemoryVault,
  createMindArchiveStore,
  defaultConfigReader,
  dreamDbPath,
  type DreamDaemon,
  type DreamRunResult,
  type MindMemoryService,
  type ChatObserverRegistry,
  type DaemonFactoryOptions,
} from '@chamber/services';
import type { TurnCompletionObserver } from '@chamber/shared';

const runtimeRequire = createRequire(__filename);

function makeFakeDaemon(): DreamDaemon & { closeCalls: number } {
  let closeCalls = 0;
  const daemon: DreamDaemon = {
    async run(): Promise<DreamRunResult> {
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
  return Object.defineProperty(daemon, 'closeCalls', {
    get: () => closeCalls,
    enumerable: true,
  }) as DreamDaemon & { closeCalls: number };
}

function makeFakeChatRegistry(): ChatObserverRegistry & {
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

function writeChamberConfig(mindPath: string, enabled: boolean): void {
  const cfg = {
    workingMemory: {
      consolidation: {
        enabled,
        cron: '0 3 * * *',
        lastKTurns: 10,
        perTurnMaxBytes: 2048,
        memoryMaxBytes: 8192,
      },
    },
  };
  writeFileSync(path.join(mindPath, '.chamber.json'), JSON.stringify(cfg, null, 2), 'utf-8');
}

interface Harness {
  readonly mindPath: string;
  readonly mindId: string;
  readonly service: MindMemoryService;
  readonly scheduler: ReturnType<typeof createInternalScheduler>;
  readonly chat: ReturnType<typeof makeFakeChatRegistry>;
  readonly daemonFactoryCalls: { count: number };
  readonly openDbs: import('better-sqlite3').Database[];
  cleanup(): Promise<void>;
}

function buildHarness(mindRoot: string, mindId: string): Harness {
  const mindPath = path.join(mindRoot, mindId);
  mkdirSync(mindPath, { recursive: true });

  const scheduler = createInternalScheduler();
  const chat = makeFakeChatRegistry();
  const daemonFactoryCalls = { count: 0 };
  const openDbs: import('better-sqlite3').Database[] = [];

  const Database = runtimeRequire('better-sqlite3') as typeof import('better-sqlite3');

  const service = createMindMemoryService({
    scheduler,
    chatService: chat,
    configReader: defaultConfigReader,
    dbFactory: (dbPath: string) => {
      // Mirror the production wiring contract: ensure the parent dir exists
      // before opening. dreamDbPath is <mindPath>/.working-memory/.state/dream.db
      mkdirSync(path.dirname(dbPath), { recursive: true });
      const db = new Database(dbPath);
      openDbs.push(db);
      return db;
    },
    vaultFactory: createMindMemoryVault,
    archiveFactory: createMindArchiveStore,
    daemonFactory: (_opts: DaemonFactoryOptions) => {
      void _opts;
      daemonFactoryCalls.count += 1;
      return makeFakeDaemon();
    },
  });

  return {
    mindPath,
    mindId,
    service,
    scheduler,
    chat,
    daemonFactoryCalls,
    openDbs,
    async cleanup() {
      try {
        await service.close();
      } catch {
        /* noop */
      }
      try {
        scheduler.close();
      } catch {
        /* noop */
      }
      // Final guard — anything still open from a half-failed activation.
      for (const db of openDbs) {
        try {
          if (db.open) db.close();
        } catch {
          /* noop */
        }
      }
    },
  };
}

describe('MindMemoryService composition (Phase 13 smoke)', () => {
  let mindRoot: string;
  let harness: Harness | null = null;

  beforeEach(() => {
    mindRoot = mkdtempSync(path.join(tmpdir(), 'chamber-mindmem-smoke-'));
  });

  afterEach(async () => {
    if (harness) {
      await harness.cleanup();
      harness = null;
    }
    rmSync(mindRoot, { recursive: true, force: true });
  });

  it('loads better-sqlite3 native module without throwing', () => {
    expect(() => runtimeRequire('better-sqlite3')).not.toThrow();
  });

  it('activateMind on a disabled config is a no-op (no db, no observer, no scheduler entry)', async () => {
    harness = buildHarness(mindRoot, 'mind-disabled');
    writeChamberConfig(harness.mindPath, false);

    await harness.service.activateMind(harness.mindId, harness.mindPath);

    expect(existsSync(dreamDbPath(harness.mindPath))).toBe(false);
    expect(harness.chat.observers).toHaveLength(0);
    expect(harness.scheduler.list().size).toBe(0);
    expect(harness.daemonFactoryCalls.count).toBe(0);
  });

  it('activateMind on an enabled config wires db, observer, and scheduler entry; releaseMind tears them all down', async () => {
    harness = buildHarness(mindRoot, 'mind-enabled');
    writeChamberConfig(harness.mindPath, true);

    await harness.service.activateMind(harness.mindId, harness.mindPath);

    const dbFile = dreamDbPath(harness.mindPath);
    expect(existsSync(dbFile)).toBe(true);
    expect(harness.chat.observers).toHaveLength(1);
    const entries = harness.scheduler.list();
    expect(entries.size).toBe(1);
    expect(entries.get(harness.mindId)).toBe('0 3 * * *');
    expect(harness.daemonFactoryCalls.count).toBe(1);

    await harness.service.releaseMind(harness.mindId);

    expect(harness.chat.observers).toHaveLength(0);
    expect(harness.scheduler.list().size).toBe(0);
    // dream.db file persists on disk (state survives mind release), but the
    // handle should be closed — `db.open` flips to false on close.
    expect(harness.openDbs).toHaveLength(1);
    expect(harness.openDbs[0]?.open).toBe(false);
  });

  it('activateMind is idempotent and close() is safe when called multiple times', async () => {
    harness = buildHarness(mindRoot, 'mind-idem');
    writeChamberConfig(harness.mindPath, true);

    await harness.service.activateMind(harness.mindId, harness.mindPath);
    await harness.service.activateMind(harness.mindId, harness.mindPath);

    expect(harness.scheduler.list().size).toBe(1);
    expect(harness.daemonFactoryCalls.count).toBe(1);

    await harness.service.close();
    await expect(harness.service.close()).resolves.toBeUndefined();
    expect(harness.scheduler.list().size).toBe(0);
    expect(harness.openDbs[0]?.open).toBe(false);
  });

  it('uses the production dream.db path under <mindPath>/.working-memory/.state/', async () => {
    harness = buildHarness(mindRoot, 'mind-path');
    writeChamberConfig(harness.mindPath, true);

    await harness.service.activateMind(harness.mindId, harness.mindPath);

    const expected = path.join(harness.mindPath, '.working-memory', '.state', 'dream.db');
    expect(dreamDbPath(harness.mindPath)).toBe(expected);
    expect(existsSync(expected)).toBe(true);
  });
});

// Reference vi to keep the import-set stable across future edits even if all
// existing tests stop using it directly.
void vi;
