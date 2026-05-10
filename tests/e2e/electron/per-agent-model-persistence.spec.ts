import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { findRendererPage, launchElectronApp, type LaunchedElectronApp } from './electronApp';
import type { ModelInfo } from '@chamber/shared/types';

const cdpPort = Number(process.env.CHAMBER_E2E_PER_AGENT_MODEL_CDP_PORT ?? 9343);

test.describe('electron per-agent model persistence smoke', () => {
  test.setTimeout(180_000);

  let app: LaunchedElectronApp | undefined;
  let userDataPath = '';
  let alphaMindPath = '';
  let betaMindPath = '';
  const tempRoots: string[] = [];

  test.beforeAll(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-per-agent-model-smoke-'));
    userDataPath = path.join(root, 'user-data');
    alphaMindPath = path.join(root, 'alpha-mind');
    betaMindPath = path.join(root, 'beta-mind');
    tempRoots.push(root);
    seedMind(alphaMindPath, 'Alpha Mind');
    seedMind(betaMindPath, 'Beta Mind');

    app = await startApp(userDataPath);
  });

  test.afterAll(async () => {
    await app?.close();
    for (const root of tempRoots) {
      await removeTempRoot(root);
    }
  });

  test('restores each mind-specific model selection after restart', async () => {
    let page = await findRendererPage(app?.browser, app?.logs ?? []);
    await waitForMindApi(page);

    const alpha = await loadMind(page, alphaMindPath, 'Alpha Mind');
    const beta = await loadMind(page, betaMindPath, 'Beta Mind');
    const models = await loadModels(page, alpha.mindId);
    test.skip(models.length < 2, 'Per-agent model smoke requires at least two SDK models.');
    const alphaModel = models[0];
    const betaModel = models[1];

    await selectMind(page, 'Alpha Mind');
    await selectModel(page, betaModel.name);
    await expectMindModel(page, alpha.mindId, betaModel.id);
    await selectModel(page, alphaModel.name);
    await expectMindModel(page, alpha.mindId, alphaModel.id);

    await selectMind(page, 'Beta Mind');
    await selectModel(page, betaModel.name);
    await expectMindModel(page, beta.mindId, betaModel.id);

    await selectMind(page, 'Alpha Mind');
    await expectSelectedModel(page, alphaModel.name);

    await app?.close();
    app = undefined;
    await delay(1_000);
    app = await startApp(userDataPath);

    page = await findRendererPage(app.browser, app.logs);
    await waitForMindApi(page);
    await expect.poll(
      async () => {
        try {
          return await page.evaluate(() => window.electronAPI.mind.list().then((minds) => minds.map((mind) => mind.identity.name).sort()));
        } catch {
          return [];
        }
      },
      { timeout: 30_000 },
    ).toEqual(['Alpha Mind', 'Beta Mind']);

    await selectMind(page, 'Alpha Mind');
    await expectSelectedModel(page, alphaModel.name);
    await selectMind(page, 'Beta Mind');
    await expectSelectedModel(page, betaModel.name);
  });

  test('disables empty-chat starter prompts while a model switch is pending', async () => {
    const page = await findRendererPage(app?.browser, app?.logs ?? []);
    await waitForMindApi(page);

    const beta = await loadMind(page, betaMindPath, 'Beta Mind');
    const models = await loadModels(page, beta.mindId);
    test.skip(models.length < 2, 'Model-switch disabled-state smoke requires at least two SDK models.');
    const currentModelName = (await page.getByRole('combobox').first().innerText()).trim();
    const nextModel = models.find((model) => model.name !== currentModelName) ?? models[1];

    await selectModel(page, nextModel.name);

    await expect(page.getByPlaceholder('Switching model…')).toBeDisabled();
    await expect(page.getByRole('combobox').first()).toHaveAttribute('data-disabled', '');
    await expect(page.getByRole('button', { name: 'Daily briefing' })).toBeDisabled();

    await expectMindModel(page, beta.mindId, nextModel.id);
    await expect(page.getByLabel('Conversation history').getByLabel(/Rename /)).toHaveCount(1);
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

async function startApp(userDataPath: string): Promise<LaunchedElectronApp> {
  return launchElectronApp({
    cdpPort,
    env: {
      CHAMBER_E2E_USER_DATA: userDataPath,
      CHAMBER_E2E_MODEL_SWITCH_DELAY_MS: '2000',
    },
  });
}

async function loadMind(page: Page, mindPath: string, name: string) {
  const mind = await page.evaluate(async (pathToMind) => {
    const loaded = await window.electronAPI.mind.add(pathToMind);
    await window.electronAPI.mind.setActive(loaded.mindId);
    return loaded;
  }, mindPath);
  await selectMind(page, name);
  return mind;
}

async function loadModels(page: Page, mindId: string): Promise<ModelInfo[]> {
  return page.evaluate((id) => window.electronAPI.chat.listModels(id), mindId);
}

async function selectMind(page: Page, name: string): Promise<void> {
  const mindButton = page.getByRole('button', { name }).first();
  await mindButton.click();
  await expect(mindButton).toHaveClass(/bg-accent/);
  await expect(page.getByPlaceholder('Message your agent… (paste an image to attach)')).toBeEnabled();
}

async function selectModel(page: Page, name: string): Promise<void> {
  const picker = page.getByRole('combobox').first();
  await expect(picker).toBeVisible();
  await picker.click();
  await page.getByRole('option', { name }).click();
}

async function expectSelectedModel(page: Page, name: string): Promise<void> {
  await expect(page.getByRole('combobox').first()).toContainText(name);
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

function seedMind(root: string, name: string): void {
  fs.mkdirSync(path.join(root, '.github', 'agents'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'SOUL.md'),
    [
      `# ${name}`,
      '',
      'A deterministic mind used by Electron per-agent model smoke tests.',
      '',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(root, '.github', 'agents', `${slugify(name)}.agent.md`),
    [
      '---',
      `name: ${name}`,
      'description: Per-agent model smoke-test persona',
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
        console.warn(`[per-agent-model-smoke] Failed to remove temp root ${root}:`, error);
        return;
      }
      await delay(250);
    }
  }
}
