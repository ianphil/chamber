// Shared SDK loader — singleton CopilotClient.
// Loads @github/copilot-sdk at runtime (not bundled — ESM-only, spawns child processes).
// On packaged builds, auto-installs SDK locally using the bundled Node runtime.
// Adapted from cmux's SdkLoader + CopilotBootstrap pattern.

import { app } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { findSystemNode as findSystemNodeShared } from './nodeResolver';
import { getGlobalNodeModules } from './SdkDiscovery';
import {
  getLocalNodeModulesDir,
  getBundledNodePath,
  getCliPathFromModules,
  isLocalInstallReady,
  ensureSdkInstalled,
} from './SdkBootstrap';

type CopilotClientType = import('@github/copilot-sdk').CopilotClient;

let sdkModule: typeof import('@github/copilot-sdk') | null = null;
let clientInstance: CopilotClientType | null = null;
let startPromise: Promise<CopilotClientType> | null = null;

// ---------------------------------------------------------------------------
// Resolve SDK modules dir — local first, then global
// ---------------------------------------------------------------------------

function resolveNodeModulesDir(): string {
  if (app.isPackaged && isLocalInstallReady()) {
    return getLocalNodeModulesDir();
  }
  return getGlobalNodeModules();
}

// ---------------------------------------------------------------------------
// Node.js binary for spawning CLI
// ---------------------------------------------------------------------------

export function findSystemNode(): string | null {
  const bundled = getBundledNodePath();
  if (bundled) return bundled;
  return findSystemNodeShared();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

async function loadSdk(): Promise<typeof import('@github/copilot-sdk')> {
  if (!sdkModule) {
    await ensureSdkInstalled();
    const modulesDir = resolveNodeModulesDir();
    const sdkEntry = path.join(modulesDir, '@github', 'copilot-sdk', 'dist', 'index.js');
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    sdkModule = await (new Function('url', 'return import(url)')(
      pathToFileURL(sdkEntry).href
    ) as Promise<typeof import('@github/copilot-sdk')>);
  }
  return sdkModule;
}

export async function getSharedClient(): Promise<CopilotClientType> {
  if (clientInstance) return clientInstance;
  if (startPromise) return startPromise;

  startPromise = (async () => {
    console.log('[SdkLoader] Loading SDK...');
    const { CopilotClient } = await loadSdk();
    const modulesDir = resolveNodeModulesDir();
    const cliPath = getCliPathFromModules(modulesDir);

    if (!cliPath) {
      throw new Error('@github/copilot CLI not found. Install @github/copilot-sdk globally.');
    }

    console.log('[SdkLoader] CLI path:', cliPath);

    const logDir = path.join(os.homedir(), '.chamber', 'logs');
    fs.mkdirSync(logDir, { recursive: true });

    let resolvedCliPath = cliPath;
    const cliArgs = ['--log-dir', logDir];

    if (cliPath.endsWith('.js')) {
      const systemNode = findSystemNode();
      if (systemNode) {
        console.log('[SdkLoader] Using Node.js:', systemNode);
        resolvedCliPath = systemNode;
        cliArgs.unshift(cliPath);
      } else {
        console.warn('[SdkLoader] Node not found, falling back to process.execPath');
      }
    }

    console.log('[SdkLoader] Resolved CLI path:', resolvedCliPath);
    console.log('[SdkLoader] CLI args:', cliArgs);

    clientInstance = new CopilotClient({
      cliPath: resolvedCliPath,
      logLevel: 'all',
      cliArgs,
    });
    console.log('[SdkLoader] Starting CopilotClient...');
    await clientInstance.start();
    console.log('[SdkLoader] CopilotClient started successfully');
    return clientInstance;
  })();

  try {
    return await startPromise;
  } catch (err) {
    clientInstance = null;
    throw err;
  } finally {
    startPromise = null;
  }
}

export async function stopSharedClient(): Promise<void> {
  if (clientInstance) {
    await clientInstance.stop().catch(() => {});
    clientInstance = null;
  }
}
