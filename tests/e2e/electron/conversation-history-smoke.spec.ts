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

  test('Monica can reuse an empty draft, resume, and rename history from the right pane', async () => {
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
    ).toBe(1);

    await renameFirstHistoryItem(page, 'Monica planning thread');

    await history.getByRole('button', { name: 'Resume Monica planning thread' }).click();
    await expect(history.getByText('Active')).toBeVisible();
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

  test('first prompt titles the active draft and hydrates automatically after restart', async () => {
    const paths = await launchWithMinds(9354, ['Monica']);
    const page = await findRendererPage(app?.browser, app?.logs ?? []);
    const mind = await addMind(page, paths.Monica);
    await installChatSendProbe(page);

    const prompt = 'History smoke first prompt title';
    const input = page.getByPlaceholder('Message your agent… (paste an image to attach)');
    await input.fill(prompt);
    await input.press('Enter');
    await page.evaluate(() => (window as typeof window & { __chamberLastChatSend?: Promise<void> }).__chamberLastChatSend);

    await expect.poll(
      () => page.evaluate(
        async ({ mindId }) => {
          const conversations = await window.electronAPI.conversationHistory.list(mindId);
          return conversations.find((conversation) => conversation.active)?.title;
        },
        { mindId: mind.mindId },
      ),
      { timeout: 60_000 },
    ).toBe(prompt);
    const history = page.getByLabel('Conversation history');
    await expect(history.getByText(prompt)).toBeVisible();
    await expect(history.getByText(/^New chat ·/)).toHaveCount(0);
    await expect(history.getByLabel(/Rename /)).toHaveCount(1);

    await app?.close();
    app = await launchElectronApp({
      cdpPort: 9355,
      env: { CHAMBER_E2E_USER_DATA: userDataPath },
    });
    const restartedPage = await findRendererPage(app.browser, app.logs);
    const restartedHistory = restartedPage.getByLabel('Conversation history');
    await expect(restartedPage.getByRole('button', { name: 'Monica' }).first()).toBeVisible();
    await expect(restartedHistory.getByText(prompt)).toBeVisible();
    await expect(restartedHistory.getByText(/^New chat ·/)).toHaveCount(0);
    await expect(restartedHistory.getByLabel(/Rename /)).toHaveCount(1);
    await expect(restartedPage.getByText(prompt).first()).toBeVisible();
  });

  test('trash deletes the active empty draft and returns to the previous conversation', async () => {
    const paths = await launchWithMinds(9356, ['Monica']);
    const page = await findRendererPage(app?.browser, app?.logs ?? []);
    const mind = await addMind(page, paths.Monica);
    await installChatSendProbe(page);

    const prompt = 'History smoke keep this chat';
    const input = page.getByPlaceholder('Message your agent… (paste an image to attach)');
    await input.fill(prompt);
    await input.press('Enter');
    await page.evaluate(() => (window as typeof window & { __chamberLastChatSend?: Promise<void> }).__chamberLastChatSend);
    await expect.poll(
      () => page.evaluate(
        async ({ mindId }) => {
          const conversations = await window.electronAPI.conversationHistory.list(mindId);
          return conversations.find((conversation) => conversation.active)?.title;
        },
        { mindId: mind.mindId },
      ),
      { timeout: 60_000 },
    ).toBe(prompt);

    const history = page.getByLabel('Conversation history');
    await expect(history.getByRole('button', { name: 'New conversation' })).toBeEnabled({ timeout: 60_000 });
    await history.getByRole('button', { name: 'New conversation' }).click();
    await expect.poll(() => history.getByLabel(/Rename /).count(), { timeout: 60_000 }).toBe(2);
    await expect(history.getByText(prompt)).toBeVisible();
    await expect(history.getByText(/^New chat ·/)).toBeVisible();

    await history.getByRole('button', { name: /^Delete New chat ·/ }).click();

    await expect.poll(() => history.getByLabel(/Rename /).count(), { timeout: 60_000 }).toBe(1);
    await expect(history.getByText(/^New chat ·/)).toHaveCount(0);
    await expect(history.getByText(prompt)).toBeVisible();
    await expect(page.getByText(prompt).first()).toBeVisible();
  });

  test('collapsing history restores chat width in a narrow window', async () => {
    const paths = await launchWithMinds(9357, ['Monica']);
    const page = await findRendererPage(app?.browser, app?.logs ?? []);
    await page.setViewportSize({ width: 900, height: 800 });
    await addMind(page, paths.Monica);

    const history = page.getByLabel('Conversation history');
    const main = page.locator('main').first();
    const expanded = await measureLayout(page);

    await history.getByRole('button', { name: 'Collapse history panel' }).click();
    await expect(history.getByRole('button', { name: 'Expand history panel' })).toBeVisible();

    await expect.poll(async () => (await measureLayout(page)).historyWidth, { timeout: 5_000 }).toBeLessThan(80);
    const collapsed = await measureLayout(page);
    expect(collapsed.historyWidth).toBeLessThan(80);
    expect(collapsed.mainWidth).toBeGreaterThan(expanded.mainWidth + 200);
    await expect(main).toBeVisible();
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

async function installChatSendProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const runtimeWindow = window as typeof window & { __chamberLastChatSend?: Promise<void> };
    const originalSend = window.electronAPI.chat.send.bind(window.electronAPI.chat);
    window.electronAPI.chat.send = (...args: Parameters<typeof window.electronAPI.chat.send>) => {
      const send = originalSend(...args);
      runtimeWindow.__chamberLastChatSend = send.then(() => undefined);
      return send;
    };
  });
}

async function measureLayout(page: Page): Promise<{ mainWidth: number; historyWidth: number }> {
  return page.evaluate(() => {
    const main = document.querySelector('main');
    const history = document.querySelector('[aria-label="Conversation history"]');
    if (!main || !history) throw new Error('Expected main and conversation history elements');
    return {
      mainWidth: main.getBoundingClientRect().width,
      historyWidth: history.getBoundingClientRect().width,
    };
  });
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
