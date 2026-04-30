import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { findRendererPage, launchElectronApp, type LaunchedElectronApp } from './electronApp';

const cdpPort = Number(process.env.CHAMBER_E2E_MARKETPLACE_AGGREGATION_CDP_PORT ?? 9340);
const publicMarketplaceId = 'github:ianphil/genesis-minds';
const internalMarketplaceId = 'github:agency-microsoft/genesis-minds';

test.describe('electron Genesis marketplace aggregation smoke', () => {
  test.setTimeout(240_000);

  let app: LaunchedElectronApp | undefined;
  let userDataPath = '';
  let genesisBasePath = '';
  const tempRoots: string[] = [];

  test.beforeAll(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-genesis-marketplace-aggregation-smoke-'));
    userDataPath = path.join(root, 'user-data');
    genesisBasePath = path.join(root, 'agents');
    tempRoots.push(root);

    seedMarketplaceConfig(userDataPath);

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

  test('shows duplicate public and internal marketplace templates as separate source-aware cards', async () => {
    const page = await findRendererPage(app?.browser, app?.logs ?? []);
    await page.waitForLoadState('domcontentloaded');

    await page.getByRole('button', { name: /New Agent/i }).click();
    await page.getByRole('button', { name: 'Begin' }).click();
    await expect(page.getByRole('button', { name: /Lucy/i }).first()).toBeVisible({ timeout: 90_000 });

    const templates = await page.evaluate(async () => window.electronAPI.genesis.listTemplates());
    const lucyTemplates = templates.filter((template) => template.id === 'lucy');

    expect(lucyTemplates.map((template) => template.source.marketplaceId).sort()).toEqual([
      internalMarketplaceId,
      publicMarketplaceId,
    ]);
    await expect(page.getByRole('button', { name: /Lucy/i })).toHaveCount(2);
  });
});

function seedMarketplaceConfig(userDataPath: string): void {
  fs.mkdirSync(userDataPath, { recursive: true });
  fs.writeFileSync(
    path.join(userDataPath, 'config.json'),
    JSON.stringify({
      version: 2,
      minds: [],
      activeMindId: null,
      activeLogin: null,
      theme: 'dark',
      marketplaceRegistries: [
        {
          id: publicMarketplaceId,
          label: 'Public Genesis Minds',
          url: 'https://github.com/ianphil/genesis-minds',
          owner: 'ianphil',
          repo: 'genesis-minds',
          ref: 'master',
          plugin: 'genesis-minds',
          enabled: true,
          isDefault: true,
        },
        {
          id: internalMarketplaceId,
          label: 'Agency Microsoft Genesis Minds',
          url: 'https://github.com/agency-microsoft/genesis-minds',
          owner: 'agency-microsoft',
          repo: 'genesis-minds',
          ref: 'main',
          plugin: 'genesis-minds',
          enabled: true,
          isDefault: false,
        },
      ],
    }, null, 2)
  );
}

async function removeTempRoot(root: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM' || attempt === 9) {
        console.warn(`[genesis-marketplace-aggregation-smoke] Failed to remove temp root ${root}:`, error);
        return;
      }
      await delay(250);
    }
  }
}
