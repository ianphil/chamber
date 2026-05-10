import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { findRendererPage, launchElectronApp, type LaunchedElectronApp } from './electronApp';

const cdpPort = Number(process.env.CHAMBER_E2E_TOOLS_RECONCILE_CDP_PORT ?? 9347);

// This spec drives the marketplace tools reconcile path end-to-end:
// 1. Launches Chamber against the public ianphil/genesis-minds marketplace.
// 2. Waits for ToolsService.reconcile() to install workiq via real `npm i -g`.
// 3. Asserts ConfigService persisted installedTools[].
// 4. Asserts window.electronAPI.tools.list() reports workiq as installed.
// 5. Forces a fresh conversation on a seeded mind so MindManager refreshes its
//    identity from disk + installedTools, exercising the startNewConversation
//    refresh path that surfaces the ## Tools system message to the SDK.
//
// Real npm install runs against the network and writes to the user's global
// npm prefix. Opt in with CHAMBER_E2E_TOOLS_RECONCILE=1 to avoid surprising
// CI runs.
const enabled = process.env.CHAMBER_E2E_TOOLS_RECONCILE === '1';

interface InstalledToolRecord {
  id: string;
  package: string;
  version: string;
  bin: string;
  displayName: string;
  description: string;
  help?: string;
  agentInstructions?: string;
}

test.describe('electron marketplace tools reconcile smoke', () => {
  test.skip(!enabled, 'Set CHAMBER_E2E_TOOLS_RECONCILE=1 to run the live npm-install marketplace tools smoke.');
  test.setTimeout(360_000);

  let app: LaunchedElectronApp | undefined;
  let userDataPath = '';
  let mindPath = '';
  const tempRoots: string[] = [];

  test.beforeAll(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-tools-reconcile-smoke-'));
    userDataPath = path.join(root, 'user-data');
    mindPath = path.join(root, 'mind');
    tempRoots.push(root);

    fs.mkdirSync(userDataPath, { recursive: true });
    fs.writeFileSync(path.join(userDataPath, 'config.json'), JSON.stringify({
      version: 2,
      minds: [{ id: 'tools-smoke-mind', path: mindPath }],
      activeMindId: 'tools-smoke-mind',
      activeLogin: null,
      theme: 'dark',
    }, null, 2));

    seedMind(mindPath);

    app = await launchElectronApp({
      cdpPort,
      env: {
        CHAMBER_E2E_USER_DATA: userDataPath,
      },
    });
  });

  test.afterAll(async () => {
    await app?.close();
    for (const root of tempRoots) {
      await removeTempRoot(root);
    }
  });

  test('reconcile installs workiq, persists it, and the renderer tools API reports it as installed', async () => {
    const page = await findRendererPage(app?.browser, app?.logs ?? []);
    await page.waitForLoadState('domcontentloaded');

    // Wait for ToolsService.reconcile() to install workiq globally and persist
    // installedTools[]. Real npm install can take a minute or two.
    await waitFor(async () => {
      const config = readConfig(userDataPath);
      return Array.isArray(config.installedTools)
        && config.installedTools.some((tool) => tool.id === 'workiq');
    }, { timeoutMs: 240_000, intervalMs: 1_000, label: 'installedTools[workiq] persisted' });

    const config = readConfig(userDataPath);
    const workiqRecord = (config.installedTools ?? []).find((tool) => tool.id === 'workiq');
    if (!workiqRecord) throw new Error('workiq tool record not found in config after reconcile');
    expect(workiqRecord.bin).toBe('workiq');
    expect(workiqRecord.package).toBe('@microsoft/workiq');
    expect(workiqRecord.agentInstructions).toContain('workiq ask');
    expect(workiqRecord.help).toBe('workiq ask --help');

    // Renderer-side: tools API surfaces the entry as installed.
    const toolsList = await page.evaluate(() => window.electronAPI.tools.list());
    const workiqEntry = toolsList.find((entry) => entry.id === 'workiq');
    expect(workiqEntry).toBeDefined();
    expect(workiqEntry?.status).toBe('installed');

    // Force a fresh conversation so MindManager.startNewConversation refreshes
    // identity from disk + installedTools and hands the SDK a system message
    // containing the ## Tools section.
    const minds = await page.evaluate(() => window.electronAPI.mind.list());
    const mind = minds.find((candidate) => candidate.mindId === 'tools-smoke-mind');
    if (!mind) throw new Error('seeded mind should be loaded');

    await page.evaluate((mindId) => window.electronAPI.chat.newConversation(mindId), mind.mindId);
  });
});

function seedMind(target: string): void {
  fs.mkdirSync(path.join(target, '.github', 'agents'), { recursive: true });
  fs.mkdirSync(path.join(target, '.working-memory'), { recursive: true });
  fs.writeFileSync(path.join(target, 'SOUL.md'), '# ToolsSmoke\nA minimal mind for the tools reconcile smoke.\n');
  fs.writeFileSync(path.join(target, '.working-memory', 'memory.md'), '');
  fs.writeFileSync(path.join(target, '.working-memory', 'rules.md'), '');
  fs.writeFileSync(path.join(target, '.working-memory', 'log.md'), '');
}

function readConfig(userDataPath: string): { installedTools?: InstalledToolRecord[] } {
  const configPath = path.join(userDataPath, 'config.json');
  if (!fs.existsSync(configPath)) return {};
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

async function waitFor(
  predicate: () => Promise<boolean>,
  options: { timeoutMs: number; intervalMs: number; label: string },
): Promise<void> {
  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(options.intervalMs);
  }
  throw new Error(`Timed out waiting for: ${options.label}`);
}

async function removeTempRoot(root: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM' || attempt === 9) {
        console.warn(`[tools-reconcile-smoke] Failed to remove temp root ${root}:`, error);
        return;
      }
      await delay(250);
    }
  }
}
