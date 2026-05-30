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
  /** Token registry - runner mints and revokes per spawn. */
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
  /**
   * Directory of the `@chamber/automation-runtime` package (the one containing
   * its package.json + src/). Used to generate tsconfig `paths` so ESM/tsc can
   * resolve the bare specifier (the ESM loader ignores NODE_PATH).
   */
  automationRuntimeDir: string;
  /** Directory of the `@ianphil/ttasks-ts` package, for the same reason. */
  ttasksDir: string;
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

    // Automation scripts use top-level `await graph.run(executor)`, which requires
    // ESM. tsx emits ESM only when the script's package scope is type:module,
    // and the ESM loader ignores NODE_PATH - so we also generate a tsconfig with
    // `paths` for the runtime packages and point tsx at it.
    ensureEsmScope(path.dirname(resolvedScript));
    const tsconfigPath = writeAutomationTsconfig(params.mindPath, resolvedScript, runtime);

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
      TSX_TSCONFIG_PATH: tsconfigPath,
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
    // Generate the same ESM scope + tsconfig the run path uses, so tsc resolves
    // `@chamber/automation-runtime` / `@ianphil/ttasks-ts` via `paths` (tsc
    // ignores NODE_PATH). The tsconfig carries the compiler flags and the single
    // script in `files`, so we just point tsc at it with `-p`.
    ensureEsmScope(path.dirname(resolvedScript));
    const tsconfigPath = writeAutomationTsconfig(params.mindPath, resolvedScript, runtime);
    const args = [tscCli, '-p', tsconfigPath];
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
 * Default runtime resolver - finds the node + tsx pair to spawn the script.
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
    return {
      nodeBinary,
      tsxCli,
      nodePath,
      automationRuntimeDir: path.join(nodePath, '@chamber', 'automation-runtime'),
      ttasksDir: path.join(nodePath, '@ianphil', 'ttasks-ts'),
    };
  }

  // Dev path - repo layout.
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
    // Point directly at the workspace package source so resolution does not
    // depend on the `node_modules/@chamber/automation-runtime` workspace link
    // being present.
    automationRuntimeDir: path.join(repoRoot, 'packages', 'automation-runtime'),
    ttasksDir: path.join(repoRoot, 'node_modules', '@ianphil', 'ttasks-ts'),
  };
}

/**
 * Ensure the automation script's package scope is ESM so tsx emits ESM (needed
 * for top-level `await graph.run(executor)`). tsx/Node decide module format from the
 * nearest package.json `type`; the mind dir has none by default. We own
 * `.chamber/automation/package.json` and merge `type:module` in idempotently,
 * preserving any other fields a user may have added.
 */
function ensureEsmScope(automationDir: string): void {
  fs.mkdirSync(automationDir, { recursive: true });
  const pkgPath = path.join(automationDir, 'package.json');
  let pkg: Record<string, unknown> = {};
  if (fs.existsSync(pkgPath)) {
    if (readJson(pkgPath)?.type === 'module') return;
    pkg = readJson(pkgPath) ?? {};
  }
  pkg.type = 'module';
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}

function readJson(file: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/**
 * Generate a tsconfig that maps the runtime package specifiers via `paths`, so
 * both tsx (run) and tsc (validate) resolve them. The ESM loader ignores
 * NODE_PATH and tsc never honored it, so explicit `paths` are the portable fix.
 * Only the two specifiers the automation contract exposes are mapped. Written to
 * the gitignored `.chamber/runs/` dir with paths relative to it.
 */
function writeAutomationTsconfig(
  mindPath: string,
  resolvedScript: string,
  runtime: ResolvedRuntime,
): string {
  const runsDir = path.join(mindPath, '.chamber', 'runs');
  fs.mkdirSync(runsDir, { recursive: true });
  const tsconfigPath = path.join(runsDir, 'automation.tsconfig.json');
  const rel = (target: string): string => {
    const r = toPosix(path.relative(runsDir, target));
    return r.length > 0 ? r : '.';
  };
  const arDir = runtime.automationRuntimeDir;
  const ttDir = runtime.ttasksDir;
  // Map the bare `@ianphil/ttasks-ts` specifier to the package's EXTENSIONLESS
  // entry (e.g. `dist/index`), not its directory. The directory yields
  // ERR_MODULE_NOT_FOUND under tsx at runtime; a concrete `.js` yields implicit
  // `any` under tsc (no types). Extensionless lets tsc resolve `index.d.ts` and
  // tsx resolve `index.js`, so scripts can import ttasks primitives directly
  // (e.g. RetryPolicy) - the same way `@chamber/automation-runtime` maps to its
  // src/index.ts.
  const ttEntry = resolvePackageEntry(ttDir);
  const typeRoots = runtime.nodePath
    .split(path.delimiter)
    .filter(Boolean)
    .map((dir) => path.join(dir, '@types'))
    .filter((dir) => fs.existsSync(dir))
    .map(rel);
  const tsconfig = {
    compilerOptions: {
      target: 'ES2023',
      module: 'esnext',
      moduleResolution: 'bundler',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      isolatedModules: true,
      noEmit: true,
      // The `@chamber/automation-runtime` paths target `.ts` source files.
      allowImportingTsExtensions: true,
      types: ['node'],
      ...(typeRoots.length > 0 ? { typeRoots } : {}),
      // `baseUrl` anchors the `paths` below for both tsc (validate) and tsx's
      // bundler resolver (run). It is deprecated in TS 6/7, so silence the
      // deprecation error rather than dropping it and risking tsx resolution.
      ignoreDeprecations: '6.0',
      baseUrl: '.',
      paths: {
        '@chamber/automation-runtime': [rel(path.join(arDir, 'src', 'index.ts'))],
        '@chamber/automation-runtime/*': [rel(path.join(arDir, 'src')) + '/*'],
        '@ianphil/ttasks-ts': [rel(ttEntry)],
        '@ianphil/ttasks-ts/*': [rel(ttDir) + '/*'],
      },
    },
    files: [rel(resolvedScript)],
  };
  fs.writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2) + '\n');
  return tsconfigPath;
}

function toPosix(value: string): string {
  return value.split(path.sep).join('/');
}

/**
 * Resolve a package's entry, WITHOUT extension, from its package.json
 * (`exports['.']` import, then `module`, then `main`), falling back to
 * `dist/index`. The extensionless form is deliberate: a tsconfig `paths` entry
 * pointing at `dist/index` lets tsc resolve `dist/index.d.ts` (types) while
 * tsx's runtime resolver picks `dist/index.js`. Pointing at a concrete `.js`
 * breaks tsc (no types -> implicit any); pointing at the bare directory breaks
 * tsx (ERR_MODULE_NOT_FOUND). Extensionless satisfies both.
 */
function resolvePackageEntry(pkgDir: string): string {
  let entry = 'dist/index.js';
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'),
    ) as {
      main?: string;
      module?: string;
      exports?: { '.'?: { import?: string } | string };
    };
    const dot = pkg.exports?.['.'];
    const fromExports = typeof dot === 'string' ? dot : dot?.import;
    entry = fromExports ?? pkg.module ?? pkg.main ?? entry;
  } catch {
    // fall through to the conventional default
  }
  const full = path.join(pkgDir, entry);
  // Strip a trailing .js/.mjs/.cjs so tsc and tsx each append their own extension.
  return full.replace(/\.(js|mjs|cjs)$/, '');
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
    out += '\n...[truncated]';
  }
  return out;
}
