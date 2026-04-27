import { chromium, type Browser, type Page } from '@playwright/test';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

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

  await waitForCdp(cdpUrl, logs);
  const browser = await chromium.connectOverCDP(cdpUrl);

  return {
    browser,
    child,
    logs,
    close: async () => {
      await browser.close();
      if (child && !child.killed) {
        child.kill();
      }
    },
  };
}

export async function findRendererPage(browser: Browser | undefined, logs: string[]): Promise<Page> {
  if (!browser) throw new Error('Browser was not connected.');
  const deadline = Date.now() + 30_000;
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
  return spawn('sh', ['-lc', command], options);
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
