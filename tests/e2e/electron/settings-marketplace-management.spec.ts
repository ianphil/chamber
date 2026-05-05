import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { findRendererPage, launchElectronApp, type LaunchedElectronApp, canAccessRepo } from './electronApp';

const cdpPort = Number(process.env.CHAMBER_E2E_SETTINGS_MARKETPLACE_CDP_PORT ?? 9342);
const mindName = 'Monica';
const internalMarketplaceUrl = 'https://github.com/agency-microsoft/genesis-minds';
const publicMarketplaceId = 'github:ianphil/genesis-minds';
const internalMarketplaceId = 'github:agency-microsoft/genesis-minds';

const hasAccess = canAccessRepo('agency-microsoft/genesis-minds');

test.describe('electron Settings marketplace management smoke', () => {
  test.skip(!hasAccess, 'Active gh account cannot access agency-microsoft/genesis-minds — run "gh auth switch" to an account with access.');
  test.setTimeout(240_000);

  let app: LaunchedElectronApp | undefined;
  let mindPath = '';
  let userDataPath = '';
  const tempRoots: string[] = [];

  test.beforeAll(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-settings-marketplace-smoke-'));
    mindPath = path.join(root, 'monica');
    userDataPath = path.join(root, 'user-data');
    tempRoots.push(root);
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

  test('adds, disables, refreshes, enables, and removes the internal marketplace from Settings', async () => {
    const page = await findRendererPage(app?.browser, app?.logs ?? []);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#root')).not.toBeEmpty();

    await page.evaluate(async (pathToMind) => {
      const mind = await window.electronAPI.mind.add(pathToMind);
      await window.electronAPI.mind.setActive(mind.mindId);
    }, mindPath);

    await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.getByText('Public Genesis Minds')).toBeVisible();

    const publicRow = rowForMarketplaceUrl(page, 'https://github.com/ianphil/genesis-minds');
    await expect(publicRow.getByText(/Enabled.*Default/)).toBeVisible();
    await expect(publicRow.getByRole('button', { name: 'Remove' })).toHaveCount(0);

    await page.getByLabel('Marketplace repository URL').fill(internalMarketplaceUrl);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Added agency-microsoft/genesis-minds', { timeout: 90_000 });

    const internalRow = rowForMarketplaceUrl(page, internalMarketplaceUrl);
    await expect(internalRow.getByText('Enabled')).toBeVisible();
    await expectMarketplaceSources(page, [internalMarketplaceId, publicMarketplaceId]);

    await internalRow.getByRole('button', { name: 'Disable' }).click();
    await expect(internalRow.getByText('Disabled')).toBeVisible();
    await expectMarketplaceSources(page, [publicMarketplaceId]);

    await internalRow.getByRole('button', { name: 'Enable' }).click();
    await expect(internalRow.getByText('Enabled')).toBeVisible();
    await internalRow.getByRole('button', { name: 'Refresh' }).click();
    await expect(page.getByRole('status')).toContainText('Refreshed agency-microsoft/genesis-minds', { timeout: 90_000 });
    await expectMarketplaceSources(page, [internalMarketplaceId, publicMarketplaceId]);

    await internalRow.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByRole('status')).toContainText('Removed agency-microsoft/genesis-minds');
    await expect(page.getByText(internalMarketplaceUrl)).toHaveCount(0);
    await expectMarketplaceSources(page, [publicMarketplaceId]);
  });
});

function rowForMarketplaceUrl(page: Awaited<ReturnType<typeof findRendererPage>>, marketplaceUrl: string) {
  return page.getByText(marketplaceUrl, { exact: true })
    .locator('xpath=ancestor::div[contains(@class,"rounded-lg") and contains(@class,"border")][1]');
}

async function expectMarketplaceSources(
  page: Awaited<ReturnType<typeof findRendererPage>>,
  expectedMarketplaceIds: string[],
): Promise<void> {
  await expect.poll(async () => {
    const templates = await page.evaluate(async () => window.electronAPI.genesis.listTemplates());
    return templates
      .filter((template) => template.id === 'lucy')
      .map((template) => template.source.marketplaceId)
      .sort();
  }, { timeout: 90_000 }).toEqual([...expectedMarketplaceIds].sort());
}

function seedMind(seedPath: string): void {
  fs.mkdirSync(path.join(seedPath, '.github', 'agents'), { recursive: true });
  fs.mkdirSync(path.join(seedPath, '.working-memory'), { recursive: true });
  fs.writeFileSync(
    path.join(seedPath, 'SOUL.md'),
    [
      `# ${mindName}`,
      '',
      `${mindName} is a deterministic smoke-test mind for Settings validation.`,
      '',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(seedPath, '.github', 'agents', 'monica.agent.md'),
    [
      '---',
      `name: ${mindName}`,
      'description: Chamber smoke-test settings persona',
      '---',
      '',
      `# ${mindName} Agent`,
      '',
      'Help the user validate Settings flows deterministically.',
      '',
    ].join('\n'),
  );
  for (const file of ['memory.md', 'rules.md', 'log.md']) {
    fs.writeFileSync(path.join(seedPath, '.working-memory', file), '');
  }
}

async function removeTempRoot(root: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM' || attempt === 9) {
        console.warn(`[settings-marketplace-smoke] Failed to remove temp root ${root}:`, error);
        return;
      }
      await delay(250);
    }
  }
}
