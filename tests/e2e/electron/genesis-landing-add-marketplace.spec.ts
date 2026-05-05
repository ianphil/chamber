import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { findRendererPage, launchElectronApp, type LaunchedElectronApp, canAccessRepo } from './electronApp';

const cdpPort = Number(process.env.CHAMBER_E2E_LANDING_MARKETPLACE_CDP_PORT ?? 9341);
const internalMarketplaceUrl = 'https://github.com/agency-microsoft/genesis-minds';
const publicMarketplaceId = 'github:ianphil/genesis-minds';
const internalMarketplaceId = 'github:agency-microsoft/genesis-minds';

const hasAccess = canAccessRepo('agency-microsoft/genesis-minds');

test.describe('electron Genesis landing Add Marketplace smoke', () => {
  test.skip(!hasAccess, 'Active gh account cannot access agency-microsoft/genesis-minds — run "gh auth switch" to an account with access.');
  test.setTimeout(240_000);

  let app: LaunchedElectronApp | undefined;
  let userDataPath = '';
  let genesisBasePath = '';
  const tempRoots: string[] = [];

  test.beforeAll(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-genesis-landing-marketplace-smoke-'));
    userDataPath = path.join(root, 'user-data');
    genesisBasePath = path.join(root, 'agents');
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

  test('adds the internal marketplace from first-run Genesis and refreshes template choices', async () => {
    const page = await findRendererPage(app?.browser, app?.logs ?? []);
    await page.waitForLoadState('domcontentloaded');

    await page.getByRole('button', { name: /New Agent/i }).click();
    await page.getByRole('button', { name: 'Add Marketplace' }).click();
    await page.getByLabel('Marketplace repository URL').fill(internalMarketplaceUrl);
    await page.getByRole('button', { name: 'Add marketplace', exact: true }).click();

    await expect(page.getByRole('status')).toContainText('Added agency-microsoft/genesis-minds', { timeout: 90_000 });

    const registries = await page.evaluate(async () => window.electronAPI.marketplace.listGenesisRegistries());
    expect(registries.find((registry) => registry.id === internalMarketplaceId)).toMatchObject({
      enabled: true,
      owner: 'agency-microsoft',
      repo: 'genesis-minds',
    });

    await page.getByRole('button', { name: 'Begin' }).click();
    await expect(page.getByRole('button', { name: /Lucy/i }).first()).toBeVisible({ timeout: 90_000 });

    const templates = await page.evaluate(async () => window.electronAPI.genesis.listTemplates());
    expect(templates.filter((template) => template.id === 'lucy').map((template) => template.source.marketplaceId).sort()).toEqual([
      internalMarketplaceId,
      publicMarketplaceId,
    ]);
  });
});

async function removeTempRoot(root: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM' || attempt === 9) {
        console.warn(`[genesis-landing-marketplace-smoke] Failed to remove temp root ${root}:`, error);
        return;
      }
      await delay(250);
    }
  }
}
