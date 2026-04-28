import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { findRendererPage, launchElectronApp, type LaunchedElectronApp } from './electronApp';

const cdpPort = Number(process.env.CHAMBER_E2E_LUCY_TEMPLATE_CDP_PORT ?? 9338);
const lucyName = 'Lucy';

test.describe('electron Genesis Lucy template smoke', () => {
  test.setTimeout(240_000);

  let app: LaunchedElectronApp | undefined;
  let userDataPath = '';
  let genesisBasePath = '';
  let lucyPath = '';
  const tempRoots: string[] = [];

  test.beforeAll(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-genesis-lucy-template-smoke-'));
    userDataPath = path.join(root, 'user-data');
    genesisBasePath = path.join(root, 'agents');
    lucyPath = path.join(genesisBasePath, 'lucy');
    tempRoots.push(root);

    app = await launchElectronApp({
      cdpPort,
      env: {
        CHAMBER_E2E_USER_DATA: userDataPath,
        CHAMBER_E2E_GENESIS_BASE_PATH: genesisBasePath,
      },
    });
  });

  test.afterAll(async () => {
    await app?.close();
    for (const root of tempRoots) {
      await removeTempRoot(root);
    }
  });

  test('installs Lucy from the Genesis minds marketplace template', async () => {
    const page = await findRendererPage(app?.browser, app?.logs ?? []);
    await page.waitForLoadState('domcontentloaded');

    await page.getByRole('button', { name: /New Agent/i }).click();
    await page.getByRole('button', { name: 'Begin' }).click();
    await expect(page.getByRole('button', { name: /Lucy/i })).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: /Lucy/i }).click();

    await expect(page.getByText('How can I help you today?')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText(lucyName)).toBeVisible();
    await expect(page.getByPlaceholder('Message your agent… (paste an image to attach)')).toBeEnabled();

    expect(fs.existsSync(path.join(lucyPath, 'SOUL.md'))).toBe(true);
    expect(fs.readFileSync(path.join(lucyPath, 'SOUL.md'), 'utf-8')).toContain('I am Lucy, a calm and practical Chief of Staff.');
    expect(fs.readFileSync(path.join(lucyPath, '.github', 'agents', 'lucy.agent.md'), 'utf-8')).toContain('name: lucy');
    expect(fs.readFileSync(path.join(lucyPath, '.working-memory', 'memory.md'), 'utf-8')).toContain('Lucy is a Genesis-created mind template');

    const result = await page.evaluate(async (name) => {
      const minds = await window.electronAPI.mind.list();
      const mind = minds.find((candidate) => candidate.identity.name === name);
      if (!mind) throw new Error(`Created mind ${name} was not loaded.`);
      return { mindName: mind.identity.name, mindPath: mind.mindPath };
    }, lucyName);

    expect(result.mindName).toBe(lucyName);
    expect(result.mindPath.toLowerCase()).toBe(lucyPath.toLowerCase());
  });
});

async function removeTempRoot(root: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM' || attempt === 9) {
        console.warn(`[genesis-lucy-template-smoke] Failed to remove temp root ${root}:`, error);
        return;
      }
      await delay(250);
    }
  }
}
