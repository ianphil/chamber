import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Logger } from '../logger';
import type { TokenRegistry } from '../automation/TokenRegistry';
import { validateScriptPath } from './validateScriptPath';
import type { CronRunStatus } from './types';

const log = Logger.create('script-runner');

export const DEFAULT_SCRIPT_TIMEOUT_MS = 10 * 60 * 1000;
const OUTPUT_CAP_BYTES = 256 * 1024;

export interface ScriptRunResult {
  status: CronRunStatus;
  graphId: string;
  output?: string;
  error?: string;
}

export interface ScriptRunnerOptions {
  /** Bridge URL injected as CHAMBER_BRIDGE_URL. Empty string = no bridge. */
  bridgeUrl: string;
  /** Token registry — runner mints and revokes per spawn. */
  tokens: TokenRegistry;
  /**
   * Override runtime resolution (used by tests). When set, ScriptRunner does
   * not look at process.resourcesPath / repo layout.
   */
  resolveRuntime?: () => ResolvedRuntime;
}

export interface ResolvedRuntime {
  nodeBinary: string;
  tsxCli: string;
  /** Node module resolution root for the spawned process. */
  nodePath: string;
}

interface ActiveChild {
  child: ChildProcess;
  runId: string;
  token: string;
  cleanup: () => void;
}

export class ScriptRunner {
  private readonly active = new Map<string, ActiveChild>();

  constructor(private readonly options: ScriptRunnerOptions) {}

  async run(params: {
    mindId: string;
    mindPath: string;
    scriptPath: string;
    timeoutMs?: number;
  }): Promise<ScriptRunResult> {
    const resolvedScript = validateScriptPath(params.mindPath, params.scriptPath);
    const runId = randomUUID();
    const graphId = randomUUID();
    const minted = this.options.tokens.mint(params.mindId, runId);
    const runtime = (this.options.resolveRuntime ?? defaultResolveRuntime)();
    const ttasksDb = path.join(params.mindPath, '.chamber', 'runs', 'ttasks.db');
    fs.mkdirSync(path.dirname(ttasksDb), { recursive: true });

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      // When nodeBinary is the Electron binary (dev), this makes it behave as
      // plain Node. Standalone Node (packaged) and the test runner ignore it.
      ELECTRON_RUN_AS_NODE: '1',
      CHAMBER_MIND_ID: params.mindId,
      CHAMBER_MIND_PATH: params.mindPath,
      CHAMBER_TTASKS_DB: ttasksDb,
      CHAMBER_GRAPH_ID: graphId,
      CHAMBER_BRIDGE_URL: this.options.bridgeUrl,
      CHAMBER_BRIDGE_TOKEN: minted.token,
      NODE_PATH: runtime.nodePath,
    };

    const timeoutMs = params.timeoutMs ?? DEFAULT_SCRIPT_TIMEOUT_MS;
    const child = spawn(runtime.nodeBinary, [runtime.tsxCli, resolvedScript], {
      cwd: params.mindPath,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let truncatedOut = false;
    let truncatedErr = false;
    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length + chunk.length > OUTPUT_CAP_BYTES) {
        const remaining = Math.max(0, OUTPUT_CAP_BYTES - stdout.length);
        stdout += chunk.toString('utf8', 0, remaining);
        truncatedOut = true;
        return;
      }
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length + chunk.length > OUTPUT_CAP_BYTES) {
        const remaining = Math.max(0, OUTPUT_CAP_BYTES - stderr.length);
        stderr += chunk.toString('utf8', 0, remaining);
        truncatedErr = true;
        return;
      }
      stderr += chunk.toString('utf8');
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      this.killChild(child);
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      this.options.tokens.revoke(minted.token);
      this.active.delete(runId);
    };
    this.active.set(runId, { child, runId, token: minted.token, cleanup });

    try {
      const exitCode = await new Promise<number | null>((resolve, reject) => {
        child.once('exit', (code) => resolve(code));
        child.once('error', (err) => {
          reject(err);
        });
      });

      const status: CronRunStatus = timedOut
        ? 'timed-out'
        : exitCode === 0
          ? 'completed'
          : 'failed';

      const output = sanitizeOutput(stdout, truncatedOut, minted.token);
      const error = status === 'completed'
        ? undefined
        : sanitizeOutput(stderr || `Script exited with code ${exitCode}`, truncatedErr, minted.token);

      return { status, graphId, output, error };
    } catch (spawnErr) {
      const err = spawnErr as Error;
      log.warn(`Spawn failed for ${params.scriptPath}:`, err);
      return {
        status: 'failed',
        graphId,
        error: err.message,
      };
    } finally {
      cleanup();
    }
  }

  /**
   * Cancels an active run by runId. Records the run as 'canceled' in the
   * resolved promise (returned by `run()`); kills the subprocess.
   */
  cancel(runId: string): boolean {
    const active = this.active.get(runId);
    if (!active) return false;
    this.killChild(active.child);
    return true;
  }

  /**
   * Type-check a script under .chamber/automation/ without executing it.
   * Spawns the bundled `tsc --noEmit` against the resolved script file using
   * the same Node + module roots as `run()`.
   */
  async validateScript(params: {
    mindPath: string;
    scriptPath: string;
  }): Promise<{ ok: boolean; output: string }> {
    const resolvedScript = validateScriptPath(params.mindPath, params.scriptPath);
    const runtime = (this.options.resolveRuntime ?? defaultResolveRuntime)();
    const tscCli = path.join(path.dirname(runtime.tsxCli), '..', '..', 'typescript', 'bin', 'tsc');
    if (!fs.existsSync(tscCli)) {
      return {
        ok: false,
        output: `automation_validate unavailable: typescript not found at ${tscCli}`,
      };
    }
    const args = [
      tscCli,
      '--noEmit',
      '--target', 'ES2023',
      '--module', 'esnext',
      '--moduleResolution', 'bundler',
      '--strict',
      '--esModuleInterop',
      '--skipLibCheck',
      '--isolatedModules',
      '--types', 'node',
      ...buildTypeRootsArgs(runtime.nodePath),
      resolvedScript,
    ];
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_PATH: runtime.nodePath,
    };
    return await new Promise((resolve) => {
      const child = spawn(runtime.nodeBinary, args, {
        cwd: params.mindPath,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      let out = '';
      const collect = (chunk: Buffer): void => {
        if (out.length < OUTPUT_CAP_BYTES) {
          out += chunk.toString('utf8', 0, Math.min(chunk.length, OUTPUT_CAP_BYTES - out.length));
        }
      };
      child.stdout?.on('data', collect);
      child.stderr?.on('data', collect);
      child.once('error', (err) => resolve({ ok: false, output: `${err.message}\n${out}` }));
      child.once('exit', (code) => resolve({ ok: code === 0, output: out.trim() }));
    });
  }

  cancelAll(): void {
    for (const active of [...this.active.values()]) {
      this.killChild(active.child);
    }
  }

  private killChild(child: ChildProcess): void {
    try {
      child.kill('SIGTERM');
      // Hard kill after 5s grace.
      setTimeout(() => {
        if (!child.killed) {
          try { child.kill('SIGKILL'); } catch { /* ignore */ }
        }
      }, 5000).unref();
    } catch {
      // ignore
    }
  }
}

/**
 * Default runtime resolver — finds the node + tsx pair to spawn the script.
 *
 * In packaged builds:  resources/node + resources/automation-runtime
 * In dev:              process.execPath (with ELECTRON_RUN_AS_NODE if Electron)
 *                      + chamber-automation-runtime/ (vendored at repo root)
 */
function defaultResolveRuntime(): ResolvedRuntime {
  const isElectronMain = typeof (process as unknown as { resourcesPath?: string }).resourcesPath === 'string'
    && !!(process as unknown as { resourcesPath?: string }).resourcesPath
    && fs.existsSync(path.join((process as unknown as { resourcesPath: string }).resourcesPath, 'automation-runtime'));

  if (isElectronMain) {
    const resourcesPath = (process as unknown as { resourcesPath: string }).resourcesPath;
    const isWin = process.platform === 'win32';
    const nodeBinary = isWin
      ? path.join(resourcesPath, 'node', 'node.exe')
      : path.join(resourcesPath, 'node', 'bin', 'node');
    const runtimeRoot = path.join(resourcesPath, 'automation-runtime');
    const tsxCli = path.join(runtimeRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const nodePath = path.join(runtimeRoot, 'node_modules');
    return { nodeBinary, tsxCli, nodePath };
  }

  // Dev path — repo layout.
  // In Electron main process at dev time, process.execPath is the Electron
  // binary; we set ELECTRON_RUN_AS_NODE via spawn env. In a vitest test,
  // process.execPath is the system node (or whatever ran vitest).
  const repoRoot = findRepoRoot();
  const runtimeRoot = path.join(repoRoot, 'chamber-automation-runtime');
  const tsxCli = path.join(runtimeRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const nodePath = [
    path.join(runtimeRoot, 'node_modules'),
    path.join(repoRoot, 'node_modules'),
  ].join(path.delimiter);
  return {
    nodeBinary: process.execPath,
    tsxCli,
    nodePath,
  };
}

/**
 * tsc resolves `--types node` against `node_modules/@types` dirs found via
 * `typeRoots`. The spawned validator's cwd is the mind directory, which has no
 * node_modules, so we point tsc at the `@types` dir inside each NODE_PATH entry
 * (the vendored runtime + repo node_modules in dev, the staged runtime when
 * packaged). Without this, validation fails with TS2688 "Cannot find type
 * definition file for 'node'".
 */
function buildTypeRootsArgs(nodePath: string): string[] {
  const roots = nodePath
    .split(path.delimiter)
    .filter(Boolean)
    .map((dir) => path.join(dir, '@types'))
    .filter((dir) => fs.existsSync(dir));
  return roots.length > 0 ? ['--typeRoots', roots.join(',')] : [];
}

function findRepoRoot(): string {
  // Climb from this file until we find chamber-automation-runtime/.
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'chamber-automation-runtime'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback: cwd.
  return process.cwd();
}

function sanitizeOutput(value: string, truncated: boolean, token: string): string | undefined {
  if (!value) return undefined;
  // Strip the bridge token from captured output. Never leak it via logs or
  // run records, even by accident.
  let out = token ? value.split(token).join('[REDACTED]') : value;
  if (truncated) {
    out += '\n…[truncated]';
  }
  return out;
}
