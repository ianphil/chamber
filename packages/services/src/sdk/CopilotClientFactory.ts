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
}

export class CopilotClientFactory {
  private sdkModule: typeof import('@github/copilot-sdk') | null = null;

  constructor(private readonly options: CopilotClientFactoryOptions = {}) {}

  async createClient(mindPath: string): Promise<CopilotClient> {
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
    // chatroom ApprovalGate), so we tell the underlying CLI to defer all
    // permission decisions to the SDK handler — which auto-approves.
    // See: https://github.com/github/copilot-sdk/releases/tag/v0.3.0
    //
    // `--add-dir` is declared explicitly per-session for the mind cwd and
    // the Chamber config root (issue #131 checklist 1). cwd already
    // scopes file access today, but listing it intentionally keeps the
    // allowed-paths surface visible in one place and prepares for a
    // follow-up that drops `--allow-all-paths`.
    const cliArgs = [
      '--log-dir', logDir,
      '--add-dir', mindPath,
      '--add-dir', chamberRoot,
      '--allow-all-tools',
      '--allow-all-paths',
      '--allow-all-urls',
    ];

    const client = new sdk.CopilotClient({
      cliPath,
      cwd: mindPath,
      logLevel: 'all',
      cliArgs,
      ...(this.options.toolsBinDir ? { env: prependToPath(this.options.env ?? process.env, this.options.toolsBinDir) } : {}),
    });

    await client.start();
    return client;
  }

  async destroyClient(client: CopilotClient): Promise<void> {
    try {
      await client.stop();
    } catch {
      // Swallow stop errors — cleanup is best-effort
    }
  }

  private async getSdk(): Promise<typeof import('@github/copilot-sdk')> {
    if (!this.sdkModule) {
      this.sdkModule = await loadSdkModule();
    }
    return this.sdkModule;
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
