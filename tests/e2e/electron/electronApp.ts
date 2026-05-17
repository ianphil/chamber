import { chromium, type Browser, type Page } from '@playwright/test';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
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
  env?: NodeJS.ProcessEnv;
}): Promise<LaunchedElectronApp> {
  const cdpUrl = options.cdpUrl ?? `http://127.0.0.1:${options.cdpPort}`;
  const logs: string[] = [];
  let child: ChildProcessWithoutNullStreams | undefined;

  if (!options.cdpUrl) {
    child = spawnNpmStart({
      cwd: repoRoot,
      env: {
        ...process.env,
        ...options.env,
        CHAMBER_DISABLE_SINGLE_INSTANCE_LOCK: '1',
        CHAMBER_E2E: '1',
        CHAMBER_E2E_CDP_PORT: String(options.cdpPort),
      },
      windowsHide: true,
    });
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
      if (child && !child.killed && typeof child.pid === 'number') {
        // The npm parent spawned Electron as a grandchild. SIGTERM on the
        // parent alone leaks Electron windows that keep the CDP port bound.
        // The child was started as a detached process group so we can SIGKILL
        // the whole tree at once via the negative pgid.
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          try { child.kill('SIGKILL'); } catch { /* already gone */ }
        }
      }
    },
  };
}

export async function findRendererPage(browser: Browser | undefined, logs: string[]): Promise<Page> {
  if (!browser) throw new Error('Browser was not connected.');
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    for (const context of browser.contexts()) {
      const page = context.pages().find((candidate) => /localhost|127\.0\.0\.1/.test(candidate.url()));
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
    return spawn('cmd.exe', ['/d', '/s', '/c', command], options);
  }
  // detached:true puts the child in its own process group so we can SIGKILL
  // the whole tree (Electron + Vite + Forge) on cleanup via -pid.
  return spawn('sh', ['-lc', command], { ...options, detached: true });
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
 * statements. Keeping it static is safe only as long as `@chamber/services`
 * has no `keytar` transitive imports (verified at commit time); a future
 * change that introduces one would re-open the EPERM window via this file.
 */
export async function canAccessRepo(nwo: string): Promise<boolean> {
  const keytarModule = await import('keytar');
  const keytar = ((keytarModule as { default?: typeof import('keytar') }).default
    ?? (keytarModule as unknown as typeof import('keytar')));
  return canAccessRepoWithChamberCredentials(nwo, keytar);
}
