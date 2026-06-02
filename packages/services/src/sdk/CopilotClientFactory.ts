// Instance-based CopilotClient factory — replaces SdkLoader singleton.
// Each mind gets its own CopilotClient (separate CLI process).

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadSdkModule } from './sdkImport';
import { resolveNodeModulesDir } from './sdkPaths';
import { getPlatformCopilotBinaryPath } from './SdkBootstrap';

import type { CopilotClient } from '@github/copilot-sdk';

export interface CopilotClientFactoryOptions {
  toolsBinDir?: string;
  env?: Record<string, string | undefined>;
  stopTimeoutMs?: number;
}

// Side-effect tool kinds Chamber auto-approves at the CLI layer. The list
// is intentionally narrow: only the patterns that the Copilot CLI exposes
// as kinds requiring approval (see `copilot help permissions`):
//   - `shell` — all shell commands (incl. git, gh, npm, pwsh, cmd)
//   - `write` — all file create/modify operations
// MCP-server tool kinds (`<server>(tool?)`) are not pre-approved — they
// fall through to `onPermissionRequest`. URL access is controlled
// separately by `--allow-url` / `--allow-all-urls`.
export const TOOLS_AUTO_APPROVED: readonly string[] = ['shell', 'write'];

// Default URL allow-list for the CLI's shell + web-fetch tools. Anything
// outside this list flows through onPermissionRequest where the SDK
// handler currently auto-approves. Patterns are protocol-aware and
// default to https:// when no scheme is given (per the CLI permissions
// docs). Subdomain coverage requires the `*.host` pattern in addition
// to the bare host.
export const URLS_ALLOWED: readonly string[] = ['github.com', '*.github.com'];
const DEFAULT_CLIENT_STOP_TIMEOUT_MS = 10_000;

export interface CreateClientOptions {
  /**
   * Additional environment variables to merge into the spawned CLI process env.
   * Used for BYO LLM (COPILOT_PROVIDER_*) without leaking config across mind
   * lifetimes. Caller passes {} (or omits) when BYO is disabled.
   */
  extraEnv?: Record<string, string>;
}

export class CopilotClientFactory {
  private sdkModule: typeof import('@github/copilot-sdk') | null = null;
  private sdkLoadPromise: Promise<typeof import('@github/copilot-sdk')> | null = null;

  constructor(private readonly options: CopilotClientFactoryOptions = {}) {}

  /**
   * Pre-load the SDK JavaScript module without spawning any CopilotClient
   * subprocess. Issue #59 — call this once at app launch (e.g. while the
   * user is still on the landing screen) so the first user-initiated
   * `createClient` does not pay the module-import cost on the critical path.
   *
   * Safe to call repeatedly and concurrently: the first call kicks off the
   * load; subsequent calls await the same Promise.
   */
  async preloadSdk(): Promise<void> {
    await this.getSdk();
  }

  async createClient(mindPath: string, createOptions: CreateClientOptions = {}): Promise<CopilotClient> {
    const sdk = await this.getSdk();
    const modulesDir = resolveNodeModulesDir();
    const cliPath = getPlatformCopilotBinaryPath(modulesDir);

    const logDir = path.join(os.homedir(), '.chamber', 'logs');
    fs.mkdirSync(logDir, { recursive: true });

    // Chamber config root. Listed under --add-dir so that --mcp servers,
    // mind credential lookups, cron job state, and other shared chamber
    // assets remain accessible to the CLI even after `--allow-all-paths`
    // is dropped in a follow-up. Today this is a no-op (`--allow-all-paths`
    // overrides per-directory entries) but it keeps the explicit
    // allowed-paths list as the source of truth in one place.
    const chamberRoot = path.join(os.homedir(), '.chamber');

    // SDK 0.3.0 enforces server-side permission rules (path verification, tool
    // gates, URL gates) that fire before our `onPermissionRequest` handler.
    // Chamber owns the security boundary itself (Electron sandbox + the
    // chatroom ApprovalGate), so anything not auto-approved at the CLI
    // layer is forwarded to the SDK handler — which auto-approves today.
    // See: https://github.com/github/copilot-sdk/releases/tag/v0.3.0
    //
    // `--add-dir` is declared explicitly per-session for the mind cwd and
    // the Chamber config root (issue #131 checklist 1). cwd already
    // scopes file access today, but listing it intentionally keeps the
    // allowed-paths surface visible in one place and prepares for a
    // follow-up that drops `--allow-all-paths`.
    //
    // `--allow-tool` is declared explicitly per-side-effect kind
    // (issue #131 checklist 2). Read-only model tools (view, ask_user,
    // str_replace, etc.) do not fire permission prompts so they need no
    // entry. URL access is handled separately by --allow-url
    // (issue #131 checklist 3).
    //
    // `--allow-url` is declared explicitly per first-party host
    // (issue #131 checklist 3). Anything not in URLS_ALLOWED falls
    // through to onPermissionRequest, where the SDK handler still
    // auto-approves — B5 will surface those denials in the chat UI.
    const cliArgs = [
      '--log-dir', logDir,
      '--add-dir', mindPath,
      '--add-dir', chamberRoot,
      ...TOOLS_AUTO_APPROVED.map((kind) => `--allow-tool=${kind}`),
      '--allow-all-paths',
      ...URLS_ALLOWED.map((host) => `--allow-url=${host}`),
    ];

    const baseEnv = this.options.env ?? process.env;
    const withTools = this.options.toolsBinDir ? prependToPath(baseEnv, this.options.toolsBinDir) : { ...baseEnv };
    const finalEnv = createOptions.extraEnv && Object.keys(createOptions.extraEnv).length > 0
      ? { ...withTools, ...createOptions.extraEnv }
      : withTools;

    const client = new sdk.CopilotClient({
      connection: sdk.RuntimeConnection.forStdio({ path: cliPath, args: cliArgs }),
      workingDirectory: mindPath,
      logLevel: 'all',
      env: finalEnv,
    });

    await client.start();
    return client;
  }

  async destroyClient(client: CopilotClient): Promise<void> {
    try {
      const stopErrors = await withTimeout(
        client.stop(),
        this.options.stopTimeoutMs ?? DEFAULT_CLIENT_STOP_TIMEOUT_MS,
        'Timed out stopping Copilot client',
      );
      if (stopErrors.length === 0) return;
    } catch {
      // Fall through to forceStop — cleanup is best-effort.
    }

    try {
      await client.forceStop();
    } catch {
      // Swallow force-stop errors — cleanup is best-effort.
    }
  }

  private async getSdk(): Promise<typeof import('@github/copilot-sdk')> {
    if (this.sdkModule) return this.sdkModule;
    // Reuse an in-flight load so concurrent callers (e.g. preloadSdk + an
    // eager createClient) only trigger one module import.
    if (!this.sdkLoadPromise) {
      this.sdkLoadPromise = loadSdkModule()
        .then((mod) => {
          this.sdkModule = mod;
          return mod;
        })
        .finally(() => {
          this.sdkLoadPromise = null;
        });
    }
    return this.sdkLoadPromise;
  }
}

function prependToPath(env: Record<string, string | undefined>, entry: string): Record<string, string | undefined> {
  const next = { ...env };
  const pathKey = Object.keys(next).find((key) => key.toLowerCase() === 'path') ?? (process.platform === 'win32' ? 'Path' : 'PATH');
  const current = next[pathKey] ?? '';
  const parts = current.split(path.delimiter).filter(Boolean);
  if (parts.some((part) => samePath(part, entry))) {
    next[pathKey] = current;
    return next;
  }
  next[pathKey] = [entry, ...parts].join(path.delimiter);
  return next;
}

function samePath(left: string, right: string): boolean {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${message} after ${timeoutMs}ms`)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
