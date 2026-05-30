import {
  TaskExecutor,
  TaskGraph,
  SqliteStore,
  createBashHandler,
  createPowershellHandler,
  type Store,
} from '@ianphil/ttasks-ts';
import { promptHandler } from './handlers/prompt';
import { notifyHandler } from './handlers/notify';
import { httpHandler } from './handlers/http';

export interface RunGraphOptions {
  /**
   * Optional store override. Defaults to SqliteStore pointed at
   * `process.env.CHAMBER_TTASKS_DB`. If neither is set, runs in-memory.
   */
  store?: Store;
  /**
   * Override the executor (e.g. to pre-register custom handlers).
   * Default is a fresh executor with bash, http, chamber:prompt,
   * chamber:notify handlers registered.
   */
  executor?: TaskExecutor;
}

/**
 * Run a ttasks graph with Chamber's default handler set wired up. Convenience
 * for cron-scheduled automation scripts:
 *
 *   const g = new TaskGraph({ id: process.env.CHAMBER_GRAPH_ID });
 *   g.add(Task.bash('echo hi'));
 *   await runGraph(g);
 *
 * The graph id MUST be the value of CHAMBER_GRAPH_ID for cron to be able to
 * join the cron run record with the ttasks rows via `cron_run_detail(runId)`.
 */
export async function runGraph(graph: TaskGraph, options: RunGraphOptions = {}): Promise<void> {
  const store = options.store ?? defaultStore();
  const executor = options.executor ?? defaultExecutor(store);
  await graph.run(executor);
  if (!options.executor) {
    await executor.shutdown();
  }
}

function defaultStore(): Store | undefined {
  const dbPath = process.env.CHAMBER_TTASKS_DB;
  if (!dbPath) return undefined;
  return new SqliteStore({ path: dbPath });
}

function defaultExecutor(store: Store | undefined): TaskExecutor {
  return createDefaultExecutor(store);
}

/**
 * Build the executor used by `runGraph` with Chamber's default handler set.
 *
 * Registers handlers for every task type Chamber automations can emit:
 * - `bash` runs `bash -c` (POSIX/WSL on Windows),
 * - `powershell` runs `pwsh -NoProfile -Command` - required for Windows-native
 *   CLIs (the a365 `teams`/`mail`/`calendar` tools, `gh`, `az`) that are not on
 *   PATH inside WSL bash,
 * - `http`, `chamber:prompt`, and `chamber:notify` for the Chamber helpers.
 *
 * Exported so registration can be asserted without spawning a shell.
 */
export function createDefaultExecutor(store: Store | undefined): TaskExecutor {
  const executor = new TaskExecutor({ store });
  executor.register('bash', createBashHandler());
  executor.register('powershell', createPowershellHandler());
  executor.register('http', httpHandler);
  executor.register('chamber:prompt', promptHandler);
  executor.register('chamber:notify', notifyHandler);
  return executor;
}
