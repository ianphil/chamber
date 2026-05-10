import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { canAccessRepo, findRendererPage, launchElectronApp, type LaunchedElectronApp } from './electronApp';

const enabled = process.env.CHAMBER_E2E_A365_RELEASE_TOOLS === '1';
const cdpPort = Number(process.env.CHAMBER_E2E_A365_RELEASE_TOOLS_CDP_PORT ?? 9348);
const heinzPath = process.env.CHAMBER_E2E_HEINZ_MIND_PATH ?? path.join(os.homedir(), 'agents', 'heinz-doofenshmirtz');
const internalMarketplaceRef = process.env.CHAMBER_E2E_A365_MARKETPLACE_REF ?? 'main';
const internalMarketplaceId = 'github:agency-microsoft/genesis-minds';
const a365ToolIds = [
  'a365-teams',
  'a365-mail',
  'a365-calendar',
  'a365-copilot365',
  'a365-planner',
  'a365-whois365',
  'a365-word',
  'a365-excel',
  'a365-sales',
];

interface InstalledToolRecord {
  id: string;
  version: string;
  bin: string;
  install?: {
    type?: string;
    owner?: string;
    repo?: string;
    tag?: string;
    assetName?: string;
    sha256?: string;
    installedPath?: string;
  };
}

test.describe('electron A365 release tools smoke', () => {
  test.skip(!enabled, 'Set CHAMBER_E2E_A365_RELEASE_TOOLS=1 to run the live A365 release-asset marketplace smoke.');
  test.setTimeout(420_000);

  let app: LaunchedElectronApp | undefined;
  let userDataPath = '';
  const tempRoots: string[] = [];

  test.beforeAll(async () => {
    test.skip(!fs.existsSync(heinzPath), `Heinz mind not found at ${heinzPath}`);
    test.skip(!await canAccessRepo('agency-microsoft/genesis-minds'), 'Stored GitHub credentials cannot access agency-microsoft/genesis-minds.');
    test.skip(!await canAccessRepo('agency-microsoft/a365-cli'), 'Stored GitHub credentials cannot access agency-microsoft/a365-cli.');

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-a365-release-tools-smoke-'));
    userDataPath = path.join(root, 'user-data');
    tempRoots.push(root);
    fs.mkdirSync(userDataPath, { recursive: true });
    fs.writeFileSync(path.join(userDataPath, 'config.json'), JSON.stringify({
      version: 2,
      minds: [{ id: 'heinz-doofenshmirtz-295a', path: heinzPath }],
      activeMindId: 'heinz-doofenshmirtz-295a',
      activeLogin: 'ianphil_microsoft',
      theme: 'dark',
      marketplaceRegistries: [
        {
          id: 'github:ianphil/genesis-minds',
          label: 'Public Genesis Minds',
          url: 'https://github.com/ianphil/genesis-minds',
          owner: 'ianphil',
          repo: 'genesis-minds',
          ref: 'master',
          plugin: 'genesis-minds',
          enabled: false,
          isDefault: true,
        },
        {
          id: internalMarketplaceId,
          label: 'Internal Genesis Minds',
          url: 'https://github.com/agency-microsoft/genesis-minds',
          owner: 'agency-microsoft',
          repo: 'genesis-minds',
          ref: internalMarketplaceRef,
          plugin: 'genesis-minds',
          enabled: true,
          isDefault: false,
        },
      ],
    }, null, 2));

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

  test('installs A365 release assets and injects them into Heinz identity tools', async () => {
    const page = await findRendererPage(app?.browser, app?.logs ?? []);
    await page.waitForLoadState('domcontentloaded');

    await waitFor(async () => {
      const installed = readConfig(userDataPath).installedTools ?? [];
      return a365ToolIds.every((id) => installed.some((tool) => tool.id === id));
    }, { timeoutMs: 300_000, intervalMs: 1_000, label: 'all A365 installedTools persisted' });

    const installed = readConfig(userDataPath).installedTools ?? [];
    for (const id of a365ToolIds) {
      const record = installed.find((tool) => tool.id === id);
      expect(record, `${id} should be persisted`).toBeDefined();
      expect(record?.install?.type).toBe('github-release-asset');
      expect(record?.install?.owner).toBe('agency-microsoft');
      expect(record?.install?.repo).toBe('a365-cli');
      expect(record?.install?.tag).toBe('v0.5.0');
      expect(record?.install?.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(record?.install?.installedPath && fs.existsSync(record.install.installedPath)).toBe(true);
    }

    const toolsList = await page.evaluate(() => window.electronAPI.tools.list());
    for (const id of a365ToolIds) {
      expect(toolsList.find((entry) => entry.id === id)?.status, `${id} should be installed in tools:list`).toBe('installed');
    }

    const minds = await page.evaluate(() => window.electronAPI.mind.list());
    const heinz = minds.find((mind) => mind.mindId === 'heinz-doofenshmirtz-295a');
    expect(heinz, 'Heinz should be loaded').toBeDefined();
    if (!heinz) return;

    await page.evaluate((mindId) => window.electronAPI.chat.newConversation(mindId), heinz.mindId);

    await expect.poll(async () => {
      const refreshedMinds = await page.evaluate(() => window.electronAPI.mind.list());
      return refreshedMinds.find((mind) => mind.mindId === 'heinz-doofenshmirtz-295a')?.identity.systemMessage ?? '';
    }, {
      timeout: 30_000,
      intervals: [500, 1_000, 2_000],
      message: 'Heinz identity should refresh with the marketplace ## Tools section.',
    }).toContain('## Tools');

    const refreshed = await page.evaluate(() => window.electronAPI.mind.list());
    const systemMessage = refreshed.find((mind) => mind.mindId === 'heinz-doofenshmirtz-295a')?.identity.systemMessage ?? '';
    expect(systemMessage).toContain('### teams — A365 Teams CLI');
    expect(systemMessage).toContain('### mail — A365 Mail CLI');
    expect(systemMessage).toContain('### calendar — A365 Calendar CLI');
    expect(systemMessage).toContain('### copilot365 — A365 Copilot CLI');
    expect(systemMessage).toContain('### planner — A365 Planner CLI');
    expect(systemMessage).toContain('### whois365 — A365 Whois CLI');
    expect(systemMessage).toContain('### word — A365 Word CLI');
    expect(systemMessage).toContain('### excel — A365 Excel CLI');
    expect(systemMessage).toContain('### sales — A365 Sales CLI');
  });
});

function readConfig(userDataPath: string): { installedTools?: InstalledToolRecord[] } {
  const configPath = path.join(userDataPath, 'config.json');
  if (!fs.existsSync(configPath)) return {};
  return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as { installedTools?: InstalledToolRecord[] };
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
        console.warn(`[a365-release-tools-smoke] Failed to remove temp root ${root}:`, error);
        return;
      }
      await delay(250);
    }
  }
}
