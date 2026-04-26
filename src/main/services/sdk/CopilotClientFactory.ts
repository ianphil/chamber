// Instance-based CopilotClient factory — replaces SdkLoader singleton.
// Each mind gets its own CopilotClient (separate CLI process).

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadSdkModule } from './sdkImport';
import { resolveNodeModulesDir } from './sdkPaths';
import { getPlatformCopilotBinaryPath } from './SdkBootstrap';

import type { CopilotClient } from '@github/copilot-sdk';

export class CopilotClientFactory {
  private sdkModule: typeof import('@github/copilot-sdk') | null = null;

  async createClient(mindPath: string): Promise<CopilotClient> {
    const sdk = await this.getSdk();
    const modulesDir = resolveNodeModulesDir();
    const cliPath = getPlatformCopilotBinaryPath(modulesDir);

    const logDir = path.join(os.homedir(), '.chamber', 'logs');
    fs.mkdirSync(logDir, { recursive: true });

    // SDK 0.3.0 enforces server-side permission rules (path verification, tool
    // gates, URL gates) that fire before our `onPermissionRequest` handler.
    // Chamber owns the security boundary itself (Electron sandbox + the
    // chatroom ApprovalGate), so we tell the underlying CLI to defer all
    // permission decisions to the SDK handler — which auto-approves.
    // See: https://github.com/github/copilot-sdk/releases/tag/v0.3.0
    const cliArgs = [
      '--log-dir', logDir,
      '--allow-all-tools',
      '--allow-all-paths',
      '--allow-all-urls',
    ];

    const client = new sdk.CopilotClient({
      cliPath,
      cwd: mindPath,
      logLevel: 'all',
      cliArgs,
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
