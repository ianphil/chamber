import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { findRendererPage, launchElectronApp, type LaunchedElectronApp } from './electronApp';

const cdpPort = Number(process.env.CHAMBER_E2E_A2A_ATTRIBUTION_CDP_PORT ?? 9339);
const monicaName = 'Monica';
const ernestName = 'Ernest';
const a2aText = 'Ian asked Ernest to tell Monica to inspect the demo transcript.';

test.describe('electron A2A sender attribution smoke', () => {
  test.setTimeout(180_000);

  let app: LaunchedElectronApp | undefined;
  let monicaPath = '';
  let ernestPath = '';
  let userDataPath = '';
  const tempRoots: string[] = [];

  test.beforeAll(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-a2a-attribution-smoke-'));
    monicaPath = path.join(root, 'monica');
    ernestPath = path.join(root, 'ernest');
    userDataPath = path.join(root, 'user-data');
    tempRoots.push(root);
    seedMind(monicaPath, monicaName, 'meticulous organizer');
    seedMind(ernestPath, ernestName, 'direct engineering partner');

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

  test('renders an Ernest-to-Monica A2A message as Ernest instead of You', async () => {
    const page = await findRendererPage(app?.browser, app?.logs ?? []);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#root')).not.toBeEmpty();

    const minds = await page.evaluate(async ({ monicaMindPath, ernestMindPath }) => {
      const monica = await window.electronAPI.mind.add(monicaMindPath);
      const ernest = await window.electronAPI.mind.add(ernestMindPath);
      await window.electronAPI.mind.setActive(monica.mindId);
      return { monica, ernest };
    }, { monicaMindPath: monicaPath, ernestMindPath: ernestPath });

    await expect.poll(
      () => page.evaluate(() => window.electronAPI.mind.list().then((loadedMinds) => loadedMinds.map((mind) => mind.identity.name).sort())),
    ).toEqual([ernestName, monicaName].sort());
    await page.getByRole('button', { name: monicaName }).first().click();
    await expect(page.getByText('How can I help you today?')).toBeVisible();

    await page.evaluate(async ({ targetMindId, fromMindId, fromName, messageText }) => {
      if (!window.electronAPI.e2e) {
        throw new Error('Expected E2E preload API to be available.');
      }
      await window.electronAPI.e2e.emitA2AIncoming({
        targetMindId,
        replyMessageId: `reply-${Date.now()}`,
        message: {
          messageId: `msg-${Date.now()}`,
          role: 'user',
          parts: [{ text: messageText, mediaType: 'text/plain' }],
          metadata: { fromId: fromMindId, fromName, hopCount: 1 },
        },
      });
    }, {
      targetMindId: minds.monica.mindId,
      fromMindId: minds.ernest.mindId,
      fromName: minds.ernest.identity.name,
      messageText: a2aText,
    });

    const a2aRow = page.getByText(a2aText).locator('xpath=ancestor::div[contains(@class,"flex gap-3")][1]');
    await expect(a2aRow.getByText(ernestName, { exact: true })).toBeVisible();
    await expect(a2aRow.getByText('You', { exact: true })).toHaveCount(0);
  });
});

function seedMind(mindPath: string, name: string, description: string): void {
  fs.mkdirSync(path.join(mindPath, '.github', 'agents'), { recursive: true });
  fs.mkdirSync(path.join(mindPath, '.working-memory'), { recursive: true });
  fs.writeFileSync(
    path.join(mindPath, 'SOUL.md'),
    [
      `# ${name}`,
      '',
      `You are ${name}, Chamber's ${description}.`,
      '',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(mindPath, '.github', 'agents', `${name.toLowerCase()}.agent.md`),
    [
      '---',
      `name: ${name}`,
      `description: Chamber smoke-test ${description}`,
      '---',
      '',
      `# ${name} Agent`,
      '',
      'Help the user with concise, deterministic responses in smoke tests.',
      '',
    ].join('\n'),
  );
  for (const file of ['memory.md', 'rules.md', 'log.md']) {
    fs.writeFileSync(path.join(mindPath, '.working-memory', file), '');
  }
}

async function removeTempRoot(root: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM' || attempt === 9) {
        console.warn(`[a2a-attribution-smoke] Failed to remove temp root ${root}:`, error);
        return;
      }
      await delay(250);
    }
  }
}
