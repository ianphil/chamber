// Shared SDK loader — singleton CopilotClient.
// Loads @github/copilot-sdk at runtime (not bundled — ESM-only, spawns child processes).
// On packaged builds, auto-installs SDK locally using the bundled Node runtime.
// Adapted from cmux's SdkLoader + CopilotBootstrap pattern.

import { app } from 'electron';
import { execSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';

type CopilotClientType = import('@github/copilot-sdk').CopilotClient;

const isWindows = process.platform === 'win32';

let sdkModule: typeof import('@github/copilot-sdk') | null = null;
let clientInstance: CopilotClientType | null = null;
let startPromise: Promise<CopilotClientType> | null = null;
let cachedPrefix: string | null = null;
let bootstrapPromise: Promise<void> | null = null;

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function getBootstrapDir(): string {
  return path.join(app.getPath('userData'), 'copilot');
}

function getLocalNodeModulesDir(): string {
  return path.join(getBootstrapDir(), 'node_modules');
}

function getBundledNodeRoot(): string | null {
  if (!app.isPackaged) return null;
  const root = path.join(process.resourcesPath, 'node');
  return fs.existsSync(root) ? root : null;
}

function getBundledNodePath(): string | null {
  const root = getBundledNodeRoot();
  if (!root) return null;
  const p = isWindows
    ? path.join(root, 'node.exe')
    : path.join(root, 'bin', 'node');
  return fs.existsSync(p) ? p : null;
}

function getBundledNpmCliPath(): string | null {
  const root = getBundledNodeRoot();
  if (!root) return null;
  const candidates = [
    path.join(root, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(root, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Local (bootstrap) install — used in packaged builds
// ---------------------------------------------------------------------------

function getCliPathFromModules(modulesDir: string): string | null {
  const nestedCli = path.join(
    modulesDir, '@github', 'copilot-sdk', 'node_modules', '@github', 'copilot', 'npm-loader.js',
  );
  if (fs.existsSync(nestedCli)) return nestedCli;

  const flatCli = path.join(modulesDir, '@github', 'copilot', 'npm-loader.js');
  if (fs.existsSync(flatCli)) return flatCli;

  return null;
}

function isLocalInstallReady(): boolean {
  const sdkPkg = path.join(getLocalNodeModulesDir(), '@github', 'copilot-sdk', 'package.json');
  return fs.existsSync(sdkPkg) && Boolean(getCliPathFromModules(getLocalNodeModulesDir()));
}

async function runNpmInstall(): Promise<void> {
  const nodePath = getBundledNodePath();
  const npmCliPath = getBundledNpmCliPath();
  if (!nodePath || !npmCliPath) {
    throw new Error('Bundled Node runtime not found. Please reinstall Chamber.');
  }

  const prefixDir = getBootstrapDir();
  const cacheDir = path.join(prefixDir, '.npm-cache');
  fs.mkdirSync(prefixDir, { recursive: true });

  await new Promise<void>((resolve, reject) => {
    const child = spawn(nodePath, [
      npmCliPath,
      'install',
      '--no-fund',
      '--no-audit',
      '--loglevel=warn',
      '--prefix', prefixDir,
      '@github/copilot-sdk',
    ], {
      env: {
        ...process.env,
        npm_config_prefix: prefixDir,
        npm_config_cache: cacheDir,
        npm_config_update_notifier: 'false',
      },
    });

    child.stdout.on('data', (d) => console.log('[SdkLoader]', d.toString().trim()));
    child.stderr.on('data', (d) => console.warn('[SdkLoader]', d.toString().trim()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`npm install exited with code ${code}`));
    });
  });
}

function ensureCopilotShim(): void {
  const cliPath = getCliPathFromModules(getLocalNodeModulesDir());
  const nodePath = getBundledNodePath();
  if (!cliPath || !nodePath || !fs.existsSync(cliPath) || !fs.existsSync(nodePath)) return;

  const shimPath = path.join(getBootstrapDir(), isWindows ? 'copilot.cmd' : 'copilot');
  const shimContent = isWindows
    ? `@echo off\r\n"${nodePath}" "${cliPath}" %*\r\n`
    : `#!/bin/sh\n"${nodePath}" "${cliPath}" "$@"\n`;
  const existing = fs.existsSync(shimPath) ? fs.readFileSync(shimPath, 'utf-8') : null;
  if (existing === shimContent) return;

  fs.mkdirSync(getBootstrapDir(), { recursive: true });
  fs.writeFileSync(shimPath, shimContent, { encoding: 'utf-8' });
  if (!isWindows) fs.chmodSync(shimPath, 0o755);
}

async function ensureSdkInstalled(): Promise<void> {
  if (!app.isPackaged) return; // dev mode — use global install

  if (isLocalInstallReady()) {
    ensureCopilotShim();
    return;
  }

  if (bootstrapPromise) return bootstrapPromise;

  bootstrapPromise = (async () => {
    console.log('[SdkLoader] SDK not found locally — installing via bundled Node...');
    await runNpmInstall();
    if (!isLocalInstallReady()) {
      throw new Error('SDK installation did not complete.');
    }
    ensureCopilotShim();
    console.log('[SdkLoader] SDK installed successfully.');
  })();

  try {
    await bootstrapPromise;
  } catch (err) {
    console.error('[SdkLoader] Install failed:', err);
    throw err;
  } finally {
    bootstrapPromise = null;
  }
}

// ---------------------------------------------------------------------------
// Global install discovery — fallback / dev mode
// ---------------------------------------------------------------------------

function parseNpmrcPrefix(rcPath: string): string | null {
  try {
    const content = fs.readFileSync(rcPath, 'utf-8');
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*prefix\s*=\s*(.+)/);
      if (match) return match[1].trim();
    }
  } catch { /* not found */ }
  return null;
}

function hasGlobalSdk(prefix: string): string | null {
  const modulesDir = isWindows
    ? path.join(prefix, 'node_modules')
    : path.join(prefix, 'lib', 'node_modules');
  if (fs.existsSync(path.join(modulesDir, '@github', 'copilot-sdk', 'package.json'))) {
    return modulesDir;
  }
  return null;
}

function getWellKnownPrefixes(): string[] {
  const home = os.homedir();
  const prefixes: string[] = [];

  if (isWindows) {
    const userPrefix = parseNpmrcPrefix(path.join(home, '.npmrc'));
    if (userPrefix) prefixes.push(userPrefix);

    for (const envKey of ['ProgramFiles', 'ProgramFiles(x86)'] as const) {
      const pf = process.env[envKey];
      if (pf) {
        const builtinRc = path.join(pf, 'nodejs', 'node_modules', 'npm', 'npmrc');
        const p = parseNpmrcPrefix(builtinRc);
        if (p) prefixes.push(p);
      }
    }

    if (process.env.APPDATA) {
      prefixes.push(path.join(process.env.APPDATA, 'npm'));
    }
  } else {
    prefixes.push('/usr/local', '/opt/homebrew', '/usr');

    const nvmDir = path.join(home, '.nvm', 'versions', 'node');
    if (fs.existsSync(nvmDir)) {
      try {
        const versions = fs.readdirSync(nvmDir).sort().reverse();
        for (const v of versions) prefixes.push(path.join(nvmDir, v));
      } catch { /* ignore */ }
    }

    const voltaDir = path.join(home, '.volta', 'tools', 'image', 'node');
    if (fs.existsSync(voltaDir)) {
      try {
        const versions = fs.readdirSync(voltaDir).sort().reverse();
        for (const v of versions) prefixes.push(path.join(voltaDir, v));
      } catch { /* ignore */ }
    }
  }

  return prefixes;
}

function getNpmGlobalPrefix(): string {
  if (cachedPrefix) return cachedPrefix;

  if (process.env.npm_config_prefix) {
    const envPrefix = process.env.npm_config_prefix;
    if (fs.existsSync(envPrefix)) {
      cachedPrefix = envPrefix;
      return cachedPrefix;
    }
  }

  try {
    cachedPrefix = execSync('npm prefix -g', { encoding: 'utf-8' }).trim();
    return cachedPrefix;
  } catch { /* npm not on PATH */ }

  for (const prefix of getWellKnownPrefixes()) {
    if (hasGlobalSdk(prefix)) {
      cachedPrefix = prefix;
      return cachedPrefix;
    }
  }

  throw new Error(
    'Could not find @github/copilot-sdk. Run: npm install -g @github/copilot-sdk'
  );
}

function getGlobalNodeModules(): string {
  const prefix = getNpmGlobalPrefix();
  const modulesDir = isWindows
    ? path.join(prefix, 'node_modules')
    : path.join(prefix, 'lib', 'node_modules');

  if (!fs.existsSync(path.join(modulesDir, '@github', 'copilot-sdk', 'package.json'))) {
    throw new Error(
      '@github/copilot-sdk is not installed globally. Run: npm install -g @github/copilot-sdk'
    );
  }
  return modulesDir;
}

// ---------------------------------------------------------------------------
// Resolve SDK modules dir — local first, then global
// ---------------------------------------------------------------------------

function resolveNodeModulesDir(): string {
  // Packaged: prefer local bootstrap install
  if (app.isPackaged && isLocalInstallReady()) {
    return getLocalNodeModulesDir();
  }
  // Fallback to global
  return getGlobalNodeModules();
}

import { findSystemNode as findSystemNodeShared } from './nodeResolver';

// ---------------------------------------------------------------------------
// Node.js binary for spawning CLI
// ---------------------------------------------------------------------------

function findSystemNode(): string | null {
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
