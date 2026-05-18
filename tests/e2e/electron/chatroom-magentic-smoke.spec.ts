import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import type { ChatroomMessage, ChatroomStreamEvent } from '@chamber/shared/chatroom-types';
import type { MindContext, ModelInfo } from '@chamber/shared/types';
import { findRendererPage, launchElectronApp, type LaunchedElectronApp } from './electronApp';

const cdpPort = Number(process.env.CHAMBER_E2E_MAGENTIC_CDP_PORT ?? 9338);
const liveMagenticEnabled = process.env.CHAMBER_E2E_LIVE_MAGENTIC === '1';

const FAST_MODEL_CANDIDATES = [
  /claude.*haiku/i,
  /gpt.*5\.4.*mini/i,
  /gpt.*5.*mini/i,
  /mini/i,
] as const;

test.describe('electron live Magentic chatroom smoke', () => {
  test.skip(!liveMagenticEnabled, 'Set CHAMBER_E2E_LIVE_MAGENTIC=1 to run the live Magentic chatroom smoke.');
  test.setTimeout(420_000);

  let app: LaunchedElectronApp | undefined;
  let root = '';
  let userDataPath = '';
  let managerPath = '';
  let workerAlphaPath = '';
  let workerBetaPath = '';

  test.beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-magentic-smoke-'));
    userDataPath = path.join(root, 'user-data');
    managerPath = path.join(root, 'manager-mind');
    workerAlphaPath = path.join(root, 'worker-alpha');
    workerBetaPath = path.join(root, 'worker-beta');
    seedMind(managerPath, 'Magentic Manager', [
      'You are a concise Chamber Magentic manager smoke-test coordinator.',
      'When asked to coordinate, follow JSON-only manager instructions exactly.',
      'Assign independent work to available workers and complete once they respond.',
    ]);
    seedMind(workerAlphaPath, 'Worker Alpha', [
      'You are Worker Alpha, a concise Chamber Magentic smoke-test worker.',
      'Complete your assigned task directly in one or two sentences.',
      'Do not use tools unless explicitly necessary.',
    ]);
    seedMind(workerBetaPath, 'Worker Beta', [
      'You are Worker Beta, a concise Chamber Magentic smoke-test worker.',
      'Complete your assigned task directly in one or two sentences.',
      'Do not use tools unless explicitly necessary.',
    ]);

    app = await launchElectronApp({
      cdpPort,
      env: { CHAMBER_E2E_USER_DATA: userDataPath },
    });
  });

  test.afterAll(async () => {
    await app?.close();
    if (root) await removeTempRoot(root);
  });

  test('runs a live Magentic round through manager, workers, ledger, and synthesis', async () => {
    const page = await findRendererPage(app?.browser, app?.logs ?? []);
    await waitForMindApi(page);

    const manager = await loadMind(page, managerPath);
    const workerAlpha = await loadMind(page, workerAlphaPath);
    const workerBeta = await loadMind(page, workerBetaPath);

    const models = await listModelsOrSkip(page, manager.mindId);
    const fastModel = chooseFastModel(models);
    test.skip(!fastModel, `Live Magentic smoke requires one fast model (${FAST_MODEL_CANDIDATES.map((rx) => rx.source).join(', ')}).`);
    await setModelForMinds(page, [manager.mindId, workerAlpha.mindId, workerBeta.mindId], fastModel!.id);

    await installChatroomEventProbe(page);
    await page.getByRole('button', { name: 'Chatroom' }).click();
    const picker = page.getByTestId('orchestration-picker');
    await picker.getByRole('button', { name: 'Magentic' }).click();
    await expect(picker.getByText('Manager:')).toBeVisible();
    await page.evaluate(({ managerMindId, workerMindIds }) =>
      window.electronAPI.chatroom.setOrchestration('magentic', {
        managerMindId,
        maxSteps: 6,
        allowedMindIds: [managerMindId, ...workerMindIds],
      }), {
        managerMindId: manager.mindId,
        workerMindIds: [workerAlpha.mindId, workerBeta.mindId],
      });

    const prompt = [
      'Live Magentic smoke test: coordinate the two workers only.',
      'Ask Worker Alpha for one short benefit of fast models in smoke tests.',
      'Ask Worker Beta for one short risk of live smoke tests.',
      'Then provide a brief final synthesis.',
    ].join(' ');
    await page.evaluate(({ message, model }) => window.electronAPI.chatroom.send(message, model), {
      message: prompt,
      model: fastModel!.id,
    });

    await expect(page.getByText('Task Ledger', { exact: true })).toBeVisible();

    const result = await page.evaluate(async () => {
      const runtimeWindow = window as typeof window & { __chamberMagenticEvents?: ChatroomStreamEvent[] };
      return {
        events: runtimeWindow.__chamberMagenticEvents ?? [],
        history: await window.electronAPI.chatroom.history(),
        ledger: await window.electronAPI.chatroom.taskLedger(),
      };
    });
    const workerIds = new Set([workerAlpha.mindId, workerBeta.mindId]);
    const assistantTexts = result.history
      .filter((message) => message.role === 'assistant')
      .map((message) => plainContent(message))
      .join('\n');

    expect(result.events.some((event) => event.event.type === 'orchestration:task-ledger-update')).toBe(true);
    expect(result.events.some((event) =>
      event.event.type === 'orchestration:synthesis'
      || event.event.type === 'orchestration:magentic-terminated',
    )).toBe(true);
    expect(result.events.some((event) => event.event.type === 'orchestration:metrics')).toBe(true);
    expect(result.events.some((event) => event.event.type === 'error')).toBe(false);
    expect(result.ledger.length).toBeGreaterThan(0);
    expect(result.ledger.some((task) => task.status === 'completed')).toBe(true);
    expect(result.ledger.some((task) => task.status === 'in-progress')).toBe(false);
    expect(result.history.some((message) => message.role === 'assistant' && workerIds.has(message.sender.mindId))).toBe(true);
    expect(assistantTexts).not.toMatch(/"action"\s*:\s*"(?:assign|plan-and-assign|update-plan|complete)"/);
    expect(assistantTexts.trim().length).toBeGreaterThan(0);
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

async function loadMind(page: Page, mindPath: string): Promise<MindContext> {
  const mind = await page.evaluate(async (pathToMind) => {
    const loaded = await window.electronAPI.mind.add(pathToMind);
    await window.electronAPI.mind.setActive(loaded.mindId);
    return loaded;
  }, mindPath);
  await page.getByRole('button', { name: mind.identity.name }).first().click();
  await expect(page.getByPlaceholder('Message your agent… (paste an image to attach)')).toBeEnabled();
  return mind;
}

async function listModelsOrSkip(page: Page, mindId: string): Promise<ModelInfo[]> {
  try {
    return await page.evaluate((id) => window.electronAPI.chat.listModels(id), mindId);
  } catch (error) {
    test.skip(true, `Live Magentic smoke requires model discovery: ${String(error)}`);
    return [];
  }
}

function chooseFastModel(models: ModelInfo[]): ModelInfo | null {
  for (const candidate of FAST_MODEL_CANDIDATES) {
    const model = models.find((entry) => candidate.test(`${entry.id} ${entry.name}`));
    if (model) return model;
  }
  return null;
}

async function setModelForMinds(page: Page, mindIds: string[], modelId: string): Promise<void> {
  await page.evaluate(async ({ ids, model }) => {
    for (const id of ids) {
      await window.electronAPI.mind.setModel(id, model);
    }
  }, { ids: mindIds, model: modelId });
  await expect.poll(
    () => page.evaluate(({ ids, model }) =>
      window.electronAPI.mind.list().then((minds) =>
        ids.every((id) => minds.find((mind) => mind.mindId === id)?.selectedModel === model),
      ), { ids: mindIds, model: modelId }),
    { timeout: 60_000 },
  ).toBe(true);
}

async function installChatroomEventProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const runtimeWindow = window as typeof window & {
      __chamberMagenticEvents?: ChatroomStreamEvent[];
    };
    runtimeWindow.__chamberMagenticEvents = [];
    window.electronAPI.chatroom.onEvent((event) => {
      runtimeWindow.__chamberMagenticEvents?.push(event);
    });
  });
}

function plainContent(message: ChatroomMessage): string {
  return message.blocks
    .filter((block): block is Extract<ChatroomMessage['blocks'][number], { type: 'text' }> => block.type === 'text')
    .map((block) => block.content)
    .join('');
}

function seedMind(root: string, name: string, instructions: string[]): void {
  fs.mkdirSync(path.join(root, '.github', 'agents'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'SOUL.md'),
    [
      `# ${name}`,
      '',
      ...instructions,
      '',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(root, '.github', 'agents', `${slugify(name)}.agent.md`),
    [
      '---',
      `name: ${name}`,
      'description: Live Magentic chatroom smoke-test persona',
      '---',
      '',
      `# ${name}`,
      '',
      ...instructions,
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
        console.warn(`[chatroom-magentic-smoke] Failed to remove temp root ${root}:`, error);
        return;
      }
      await delay(250);
    }
  }
}
