import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { findRendererPage, launchElectronApp, type LaunchedElectronApp } from './electronApp';

const cdpPort = Number(process.env.CHAMBER_E2E_MONICA_CDP_PORT ?? 9335);
const expectedReply = 'CHAMBER_MONICA_READY_ACK';
const memoryInstruction = `When asked for the Monica smoke acknowledgement, answer exactly ${expectedReply} and no other text.`;

test.describe('electron Monica existing mind smoke', () => {
  test.setTimeout(180_000);

  let app: LaunchedElectronApp | undefined;
  let mindPath = '';
  let userDataPath = '';
  const tempRoots: string[] = [];

  test.beforeAll(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-monica-smoke-'));
    mindPath = path.join(root, 'monica');
    userDataPath = path.join(root, 'user-data');
    tempRoots.push(root);
    seedMonicaMind(mindPath);

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

  test('opens an existing Monica mind and completes a live chat turn', async () => {
    const page = await findRendererPage(app?.browser, app?.logs ?? []);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#root')).not.toBeEmpty();
    await expect(page.getByRole('button', { name: /Open Existing/i })).toBeVisible();

    const mind = await page.evaluate(async (pathToMind) => {
      const mind = await window.electronAPI.mind.add(pathToMind);
      await window.electronAPI.mind.setActive(mind.mindId);
      return mind;
    }, mindPath);

    await expect.poll(
      () => page.evaluate(() => window.electronAPI.mind.list().then((minds) => minds.map((item) => item.identity.name))),
    ).toEqual(['Monica']);

    const nestedMindPath = path.join(mindPath, '.github', 'agents');
    const sameMind = await page.evaluate(async (nestedPathToMind) => {
      const sameMind = await window.electronAPI.mind.add(nestedPathToMind);
      await window.electronAPI.mind.setActive(sameMind.mindId);
      return sameMind;
    }, nestedMindPath);

    await expect.poll(
      () => page.evaluate(() => window.electronAPI.mind.list().then((minds) => minds.map((item) => item.identity.name))),
    ).toEqual(['Monica']);

    expect(sameMind.mindId).toBe(mind.mindId);
    const monicaSidebarButton = page.locator('button').filter({ hasText: /\bMonica\b/ });
    await expect(monicaSidebarButton).toHaveCount(1);
    await monicaSidebarButton.click();
    await expect(page.getByText('How can I help you today?')).toBeVisible();
    await expect(page.getByPlaceholder('Message your agent… (paste an image to attach)')).toBeEnabled();
    expect(mind.identity.name).toBe('Monica');

    const result = await page.evaluate(async ({ expected, mindId }) => {
      const messageId = `monica-smoke-${Date.now()}`;
      const events: Array<{ type: string; content?: string; message?: string }> = [];
      let assistantText = '';
      let errorMessage = '';
      let resolveTerminal: () => void = () => undefined;
      const terminal = new Promise<void>((resolve) => {
        resolveTerminal = resolve;
      });
      const unsubscribe = window.electronAPI.chat.onEvent((receivedMindId, receivedMessageId, event) => {
        if (receivedMindId !== mindId || receivedMessageId !== messageId) return;
        events.push(event);
        if (event.type === 'chunk' || event.type === 'message_final') {
          assistantText += event.content;
        }
        if (event.type === 'error') {
          errorMessage = event.message;
          resolveTerminal();
        }
        if (event.type === 'done') {
          resolveTerminal();
        }
      });

      try {
        const send = window.electronAPI.chat.send(
          mindId,
          `This is a live Chamber Monica smoke test. Reply with exactly ${expected} and no other text.`,
          messageId,
        );
        const timeout = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Timed out waiting for Monica smoke response.')), 180_000);
        });
        await Promise.race([Promise.all([send, terminal]), timeout]);
        return { assistantText, errorMessage, events };
      } finally {
        unsubscribe();
      }
    }, { expected: expectedReply, mindId: mind.mindId });

    expect(result.errorMessage).toBe('');
    expect(result.assistantText).toContain(expectedReply);
    expect(result.events.some((event) => event.type === 'done')).toBe(true);

    await page.evaluate((mindId) => window.electronAPI.mind.remove(mindId), mind.mindId);
  });
});

function seedMonicaMind(mindPath: string): void {
  fs.mkdirSync(path.join(mindPath, '.github', 'agents'), { recursive: true });
  fs.mkdirSync(path.join(mindPath, '.working-memory'), { recursive: true });
  fs.writeFileSync(
    path.join(mindPath, 'SOUL.md'),
    [
      '# Monica',
      '',
      'You are Monica, Chamber\'s meticulous, upbeat, systems-minded organizer.',
      memoryInstruction,
      '',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(mindPath, '.github', 'agents', 'monica.agent.md'),
    [
      '---',
      'name: Monica',
      'description: Chamber smoke-test organizer persona',
      '---',
      '',
      '# Monica Agent',
      '',
      'Help the user organize work with crisp checklists, clean priorities, and cheerful precision.',
      '',
    ].join('\n'),
  );
  for (const file of ['memory.md', 'rules.md', 'log.md']) {
    fs.writeFileSync(
      path.join(mindPath, '.working-memory', file),
      file === 'memory.md' ? `${memoryInstruction}\n` : '',
    );
  }
}

async function removeTempRoot(root: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM' || attempt === 9) {
        console.warn(`[monica-smoke] Failed to remove temp root ${root}:`, error);
        return;
      }
      await delay(250);
    }
  }
}
