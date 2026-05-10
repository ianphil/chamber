import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { findRendererPage, launchElectronApp, type LaunchedElectronApp } from './electronApp';

const cdpPort = Number(process.env.CHAMBER_E2E_COMPOSE_DRAFTS_CDP_PORT ?? 9344);
const chatPlaceholder = 'Message your agent… (paste an image to attach)';

test.describe('electron per-agent compose drafts smoke', () => {
  test.setTimeout(180_000);

  let app: LaunchedElectronApp | undefined;
  let userDataPath = '';
  let alphaMindPath = '';
  let betaMindPath = '';
  const tempRoots: string[] = [];

  test.beforeAll(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-compose-drafts-smoke-'));
    userDataPath = path.join(root, 'user-data');
    alphaMindPath = path.join(root, 'alpha-mind');
    betaMindPath = path.join(root, 'beta-mind');
    tempRoots.push(root);
    seedMind(alphaMindPath, 'Alpha Mind');
    seedMind(betaMindPath, 'Beta Mind');

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

  test('preserves unsent compose drafts per active mind', async () => {
    const page = await findRendererPage(app?.browser, app?.logs ?? []);
    await waitForMindApi(page);

    await loadMind(page, alphaMindPath, 'Alpha Mind');
    await loadMind(page, betaMindPath, 'Beta Mind');

    await selectMind(page, 'Alpha Mind');
    await fillDraft(page, 'alpha draft');

    await selectMind(page, 'Beta Mind');
    await expectDraft(page, '');
    await fillDraft(page, 'beta draft');

    await selectMind(page, 'Alpha Mind');
    await expectDraft(page, 'alpha draft');

    await selectMind(page, 'Beta Mind');
    await expectDraft(page, 'beta draft');

    await fillDraft(page, '');

    await selectMind(page, 'Alpha Mind');
    await expectDraft(page, 'alpha draft');

    await selectMind(page, 'Beta Mind');
    await expectDraft(page, '');
  });
});

async function waitForMindApi(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#root')).not.toBeEmpty();
  await expect.poll(async () => {
    try {
      return await page.evaluate(() => typeof window.electronAPI?.mind?.list);
    } catch {
      return 'unavailable';
    }
  }, { timeout: 30_000 }).toBe('function');
}

async function loadMind(page: Page, mindPath: string, name: string): Promise<void> {
  await page.evaluate(async (pathToMind) => {
    const loaded = await window.electronAPI.mind.add(pathToMind);
    await window.electronAPI.mind.setActive(loaded.mindId);
  }, mindPath);
  await selectMind(page, name);
}

async function selectMind(page: Page, name: string): Promise<void> {
  const mindButton = page.getByRole('button', { name }).first();
  await mindButton.click();
  await expect(mindButton).toHaveClass(/bg-accent/);
  await expect(page.getByPlaceholder(chatPlaceholder)).toBeEnabled();
}

async function fillDraft(page: Page, draft: string): Promise<void> {
  await page.getByPlaceholder(chatPlaceholder).fill(draft);
}

async function expectDraft(page: Page, draft: string): Promise<void> {
  await expect(page.getByPlaceholder(chatPlaceholder)).toHaveValue(draft);
}

function seedMind(root: string, name: string): void {
  fs.mkdirSync(path.join(root, '.github', 'agents'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'SOUL.md'),
    [
      `# ${name}`,
      '',
      'A deterministic mind used by Electron per-agent compose draft smoke tests.',
      '',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(root, '.github', 'agents', `${slugify(name)}.agent.md`),
    [
      '---',
      `name: ${name}`,
      'description: Per-agent compose draft smoke-test persona',
      '---',
      '',
      `# ${name}`,
      '',
    ].join('\n'),
  );
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function removeTempRoot(root: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM' || attempt === 9) {
        console.warn(`[per-agent-compose-drafts-smoke] Failed to remove temp root ${root}:`, error);
        return;
      }
      await delay(250);
    }
  }
}
