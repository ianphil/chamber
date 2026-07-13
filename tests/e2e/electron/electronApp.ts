import { chromium, type Browser, type Page } from '@playwright/test';
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { canAccessRepoWithChamberCredentials } from './chamberRepoAccess';

export const repoRoot = path.resolve(__dirname, '..', '..', '..');

export interface LaunchedElectronApp {
  browser: Browser;
  child?: ChildProcessWithoutNullStreams;
  logs: string[];
  close: () => Promise<void>;
}

export async function launchElectronApp(options: {
  cdpPort: number;
  cdpUrl?: string;
  executablePath?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<LaunchedElectronApp> {
  const cdpUrl = options.cdpUrl ?? `http://127.0.0.1:${options.cdpPort}`;
  const logs: string[] = [];
  let child: ChildProcessWithoutNullStreams | undefined;

  if (!options.cdpUrl) {
    const launchOptions = {
      cwd: repoRoot,
      env: {
        ...process.env,
        ...options.env,
        CHAMBER_DISABLE_SINGLE_INSTANCE_LOCK: '1',
        CHAMBER_E2E: '1',
        CHAMBER_E2E_CDP_PORT: String(options.cdpPort),
      },
      windowsHide: true,
    };
    child = options.executablePath
      ? spawn(options.executablePath, [], launchOptions)
      : spawnNpmStart(launchOptions);
    child.stdout.on('data', (chunk) => logs.push(String(chunk)));
    child.stderr.on('data', (chunk) => logs.push(String(chunk)));
  }

  let browser: Browser;
  try {
    await waitForCdp(cdpUrl, logs);
    browser = await chromium.connectOverCDP(cdpUrl, { timeout: 120_000 });
  } catch (error) {
    if (child && !child.killed) {
      child.kill();
    }
    throw error;
  }

  return {
    browser,
    child,
    logs,
    close: async () => {
      try {
        await browser.close();
      } catch {
        // Browser may already be gone; continue with process cleanup.
      }
      if (child && typeof child.pid === 'number') {
        await killProcessTree(child);
      }
    },
  };
}

export async function findRendererPage(browser: Browser | undefined, logs: string[]): Promise<Page> {
  if (!browser) throw new Error('Browser was not connected.');
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    for (const context of browser.contexts()) {
      const page = context.pages().find((candidate) => /localhost|127\.0\.0\.1|^file:/.test(candidate.url()));
      if (page) return page;
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for Electron renderer page.\n${logsPreview(logs)}`);
}

function spawnNpmStart(options: {
  cwd: string;
  env: NodeJS.ProcessEnv;
  windowsHide: boolean;
}): ChildProcessWithoutNullStreams {
  const command = 'npm start';
  if (process.platform === 'win32') {
    return spawn('cmd.exe', ['/d', '/s', '/c', command], { ...options, detached: true });
  }
  // detached:true puts the child in its own process group so we can SIGKILL
  // the whole tree (Electron + Vite + Forge) on cleanup via -pid.
  return spawn('sh', ['-lc', command], { ...options, detached: true });
}

async function killProcessTree(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (typeof child.pid !== 'number') return;
  if (process.platform === 'win32') {
    try {
      await execFileAsync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F']);
      return;
    } catch {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      return;
    }
  }

  // The child starts as a detached process group so negative pgid terminates
  // Electron, Vite, Forge, and npm together instead of leaking descendants.
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
  }
}

function execFileAsync(file: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, args, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function waitForCdp(url: string, logs: string[]): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/json/version`);
      if (response.ok) return;
    } catch {
      // Keep polling until Electron enables the debugging endpoint.
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for Electron CDP endpoint at ${url}.\n${logsPreview(logs)}`);
}

function logsPreview(logs: string[]): string {
  return logs.slice(-80).join('\n');
}

/**
 * Returns true when Chamber's runtime would be able to access the given repo
 * via either the anonymous GitHub API or one of the GitHub credentials the
 * runtime itself would consider eligible. Use with `test.skip()` to skip
 * marketplace and release-tools tests that need a private repo.
 *
 * The credential filter mirrors `listStoredGitHubCredentials` from
 * `@chamber/services`, which is the same filter
 * `GitHubRegistryClient.withCredentialStore` and
 * `GitHubReleaseAssetClient.withCredentialStore` apply. Iterating any
 * superset (e.g., raw `keytar.findCredentials('copilot-cli')`) would let the
 * guard return true on entries the runtime never tries — causing specs to
 * run when the runtime can't actually fetch the repo.
 *
 * Loads keytar lazily so the Playwright runner process doesn't hold the
 * keytar.node native addon open. On Windows, an open keytar.node prevents
 * `electron-forge start` from rebuilding it for Electron's ABI (EPERM on
 * unlink), which breaks every Electron spec. See CHANGELOG #250 for the
 * original incident. The keytar dynamic import here is the only deferral
 * that protects against that — do not collapse it into a top-level static
 * import.
 *
 * `canAccessRepoWithChamberCredentials` is imported statically (top of
 * file) because Playwright's TypeScript loader handles static imports of
 * sibling `.ts` files but routes `await import('./helper')` through Node's
 * native loader, which rejects the helper's top-level ESM `import`
 * statements. The helper imports the auth module directly instead of the
 * services barrel so unrelated native or runtime dependencies are not loaded
 * into Playwright's runner process.
 */
export async function canAccessRepo(nwo: string): Promise<boolean> {
  const keytarModule = await import('keytar');
  const keytar = ((keytarModule as { default?: typeof import('keytar') }).default
    ?? (keytarModule as unknown as typeof import('keytar')));
  return canAccessRepoWithChamberCredentials(nwo, keytar);
}
