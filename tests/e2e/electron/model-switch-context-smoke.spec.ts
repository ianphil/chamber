import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import type { ModelInfo } from '@chamber/shared/types';
import { findRendererPage, launchElectronApp, type LaunchedElectronApp } from './electronApp';

test.describe('electron model switch conversation context smoke', () => {
  test.setTimeout(180_000);

  let app: LaunchedElectronApp | undefined;
  let root = '';
  let userDataPath = '';

  test.afterEach(async () => {
    await app?.close();
    app = undefined;
    if (root) await removeTempRoot(root);
  });

  test('switches model mid-conversation and sends another turn without creating history or losing session', async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-model-switch-context-smoke-'));
    userDataPath = path.join(root, 'user-data');
    const mindPath = path.join(root, 'heinz-doofenshmirtz');
    seedMind(mindPath, 'Heinz Doofenshmirtz');
    app = await launchElectronApp({
      cdpPort: 9361,
      env: { CHAMBER_E2E_USER_DATA: userDataPath },
    });
    const page = await findRendererPage(app.browser, app.logs);
    await waitForMindApi(page);
    const mind = await loadMind(page, mindPath, 'Heinz Doofenshmirtz');
    const models = await page.evaluate((mindId) => window.electronAPI.chat.listModels(mindId), mind.mindId);
    test.skip(models.length < 2, 'Model-switch context smoke requires at least two SDK models.');
    await installChatSendProbe(page);

    const sentinelToken = `purplezebra${Date.now().toString(36)}`;
    const firstPrompt = `Remember the secret token "${sentinelToken}". Reply with just the word OK.`;
    await sendAndWait(page, firstPrompt);
    await expect(page.getByText(firstPrompt).first()).toBeVisible();
    await expectNoSessionError(page);

    const history = page.getByLabel('Conversation history');
    await expect(history.getByText(firstPrompt)).toBeVisible();
    const rowsAfterFirstTurn = await history.getByLabel(/Rename /).count();
    const nextModel = await findNextModel(page, models);
    await selectModel(page, nextModel.name);
    await expectMindModel(page, mind.mindId, nextModel.id);
    await expect.poll(() => history.getByLabel(/Rename /).count(), { timeout: 30_000 }).toBe(rowsAfterFirstTurn);

    const secondPrompt = 'Repeat the secret token I gave you a moment ago, exactly.';
    await sendAndWait(page, secondPrompt);

    await expect(page.getByText(secondPrompt).first()).toBeVisible();
    await expectNoSessionError(page);
    await expect.poll(() => history.getByLabel(/Rename /).count(), { timeout: 30_000 }).toBe(rowsAfterFirstTurn);
    await expect(history.getByText(firstPrompt)).toBeVisible();
    // Conversation context must survive an in-place model switch — the model should recall the sentinel.
    await expect(page.getByText(new RegExp(sentinelToken)).first()).toBeVisible({ timeout: 60_000 });
  });
});

async function waitForMindApi(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#root')).not.toBeEmpty();
  await expect.poll(async () => {
    try {
      return await page.evaluate(() => typeof window.electronAPI?.mind?.add);
    } catch {
      return 'unavailable';
    }
  }, { timeout: 30_000 }).toBe('function');
}

async function loadMind(page: Page, mindPath: string, name: string) {
  const mind = await page.evaluate(async (pathToMind) => {
    const loaded = await window.electronAPI.mind.add(pathToMind);
    await window.electronAPI.mind.setActive(loaded.mindId);
    return loaded;
  }, mindPath);
  const mindButton = page.getByRole('button', { name }).first();
  await mindButton.click();
  await expect(mindButton).toHaveClass(/bg-accent/);
  await expect(page.getByPlaceholder('Message your agent… (paste an image to attach)')).toBeEnabled();
  return mind;
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

async function sendAndWait(page: Page, prompt: string): Promise<void> {
  const input = page.getByPlaceholder('Message your agent… (paste an image to attach)');
  await expect(input).toBeEnabled();
  await input.fill(prompt);
  await input.press('Enter');
  await page.evaluate(() => (window as typeof window & { __chamberLastChatSend?: Promise<void> }).__chamberLastChatSend);
}

async function findNextModel(page: Page, models: ModelInfo[]): Promise<ModelInfo> {
  const currentModelName = (await page.getByRole('combobox').first().innerText()).trim();
  return models.find((model) => model.name !== currentModelName) ?? models[1];
}

async function selectModel(page: Page, name: string): Promise<void> {
  const picker = page.getByRole('combobox').first();
  await expect(picker).toBeVisible();
  await picker.click();
  await page.getByRole('option', { name }).click();
}

async function expectMindModel(page: Page, mindId: string, selectedModel: string): Promise<void> {
  await expect.poll(
    () => page.evaluate(
      ({ mindId }) => window.electronAPI.mind.list().then((minds) => minds.find((mind) => mind.mindId === mindId)?.selectedModel),
      { mindId },
    ),
    { timeout: 60_000 },
  ).toBe(selectedModel);
}

async function expectNoSessionError(page: Page): Promise<void> {
  await expect(page.getByText(/Session not found/i)).toHaveCount(0);
  await expect(page.getByText(/^Error:/)).toHaveCount(0);
}

function seedMind(root: string, name: string): void {
  fs.mkdirSync(path.join(root, '.github', 'agents'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'SOUL.md'),
    [
      `# ${name}`,
      '',
      'A deterministic mind used by Electron model-switch context smoke tests.',
      '',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(root, '.github', 'agents', 'heinz-doofenshmirtz.agent.md'),
    [
      '---',
      `name: ${name}`,
      'description: Model-switch context smoke-test persona',
      '---',
      '',
      `# ${name}`,
      '',
      'Answer briefly so smoke tests finish quickly.',
      '',
    ].join('\n'),
  );
}

async function removeTempRoot(root: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM' || attempt === 9) {
        console.warn(`[model-switch-context-smoke] Failed to remove temp root ${root}:`, error);
        return;
      }
      await delay(250);
    }
  }
}
