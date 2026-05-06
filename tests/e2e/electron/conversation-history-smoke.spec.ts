import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { findRendererPage, launchElectronApp, type LaunchedElectronApp } from './electronApp';

test.describe('electron conversation history smoke', () => {
  test.setTimeout(180_000);

  let app: LaunchedElectronApp | undefined;
  let root = '';
  let userDataPath = '';

  test.afterEach(async () => {
    await app?.close();
    app = undefined;
    if (root) await removeTempRoot(root);
  });

  test('Monica can create, resume, and rename history entries from the right pane', async () => {
    const paths = await launchWithMinds(9350, ['Monica']);
    const page = await findRendererPage(app?.browser, app?.logs ?? []);
    await addMind(page, paths.Monica);

    const history = page.getByLabel('Conversation history');
    await expect(history).toBeVisible();
    await expect(history.getByLabel(/Rename /).first()).toBeVisible();

    await history.getByRole('button', { name: 'New conversation' }).click();
    await expect.poll(
      () => history.getByLabel(/Rename /).count(),
      { timeout: 60_000 },
    ).toBeGreaterThanOrEqual(2);

    await renameFirstHistoryItem(page, 'Monica planning thread');

    await history.getByRole('button', { name: /Resume / }).last().click();
    await expect(history.getByText('Active')).toBeVisible();
    await history.getByRole('button', { name: 'Resume Monica planning thread' }).click();
    await expect(history.getByText('Monica planning thread')).toBeVisible();
  });

  test('Monica and Lucy histories stay isolated by active mind', async () => {
    const paths = await launchWithMinds(9351, ['Monica', 'Lucy']);
    const page = await findRendererPage(app?.browser, app?.logs ?? []);
    await addMind(page, paths.Monica);
    await renameFirstHistoryItem(page, 'Monica only');
    await addMind(page, paths.Lucy);
    await renameFirstHistoryItem(page, 'Lucy only');

    const history = page.getByLabel('Conversation history');
    await page.getByRole('button', { name: 'Monica' }).first().click();
    await expect(history.getByText('Monica only')).toBeVisible();
    await expect(history.getByText('Lucy only')).toHaveCount(0);

    await page.getByRole('button', { name: 'Lucy' }).first().click();
    await expect(history.getByText('Lucy only')).toBeVisible();
    await expect(history.getByText('Monica only')).toHaveCount(0);
  });

  test('Lucy history reloads after an app restart', async () => {
    const paths = await launchWithMinds(9352, ['Lucy']);
    const page = await findRendererPage(app?.browser, app?.logs ?? []);
    await addMind(page, paths.Lucy);

    await renameFirstHistoryItem(page, 'Lucy restart thread');

    await app?.close();
    app = await launchElectronApp({
      cdpPort: 9353,
      env: { CHAMBER_E2E_USER_DATA: userDataPath },
    });
    const restartedPage = await findRendererPage(app.browser, app.logs);
    await expect(restartedPage.getByRole('button', { name: 'Lucy' }).first()).toBeVisible();
    await expect(restartedPage.getByLabel('Conversation history').getByText('Lucy restart thread')).toBeVisible();
  });

  async function launchWithMinds(cdpPort: number, names: string[]): Promise<Record<string, string>> {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-history-smoke-'));
    userDataPath = path.join(root, 'user-data');
    const paths: Record<string, string> = {};
    for (const name of names) {
      paths[name] = path.join(root, name.toLowerCase());
      seedMind(paths[name], name);
    }
    app = await launchElectronApp({
      cdpPort,
      env: { CHAMBER_E2E_USER_DATA: userDataPath },
    });
    return paths;
  }
});

async function addMind(page: Page, mindPath: string) {
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#root')).not.toBeEmpty();
  await expect.poll(() => page.evaluate(() => typeof window.electronAPI?.mind?.add)).toBe('function');
  const mind = await page.evaluate(async (pathToMind) => {
    const loaded = await window.electronAPI.mind.add(pathToMind);
    await window.electronAPI.mind.setActive(loaded.mindId);
    return loaded;
  }, mindPath);
  await page.getByRole('button', { name: mind.identity.name }).first().click();
  await expect(page.getByLabel('Conversation history').getByLabel(/Rename /).first()).toBeVisible();
  return mind;
}

async function renameFirstHistoryItem(page: Page, title: string): Promise<void> {
  const history = page.getByLabel('Conversation history');
  await history.getByLabel(/Rename /).first().click();
  const input = history.locator('input').first();
  await input.fill(title);
  await input.press('Enter');
  await expect(history.getByText(title)).toBeVisible();
}

function seedMind(targetMindPath: string, name: string): void {
  fs.mkdirSync(path.join(targetMindPath, '.github', 'agents'), { recursive: true });
  fs.writeFileSync(
    path.join(targetMindPath, 'SOUL.md'),
    [
      `# ${name}`,
      '',
      `You are ${name}, a concise Chamber smoke-test assistant.`,
      '',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(targetMindPath, '.github', 'agents', `${name.toLowerCase()}.agent.md`),
    [
      '---',
      `name: ${name}`,
      'description: Chamber conversation history smoke persona',
      '---',
      '',
      `# ${name} Agent`,
      '',
    ].join('\n'),
  );
}

async function removeTempRoot(targetRoot: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      fs.rmSync(targetRoot, { recursive: true, force: true });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM' || attempt === 9) {
        console.warn(`[conversation-history-smoke] Failed to remove temp root ${targetRoot}:`, error);
        return;
      }
      await delay(250);
    }
  }
}
