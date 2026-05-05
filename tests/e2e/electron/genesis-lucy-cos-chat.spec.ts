import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { findRendererPage, launchElectronApp, type LaunchedElectronApp } from './electronApp';

const cdpPort = Number(process.env.CHAMBER_E2E_LUCY_COS_CDP_PORT ?? 9344);
const expectedReply = 'CHAMBER_LUCY_COS_READY_ACK';
const lucyName = 'Lucy';
const memoryInstruction = `When asked for the Lucy Chief of Staff smoke acknowledgement, answer exactly ${expectedReply} and no other text.`;

// This spec drives a real Copilot SDK turn end-to-end. It is opt-in because:
//   - It requires a logged-in Copilot account in the Electron app.
//   - It takes several minutes (model latency + wizard navigation).
// Set CHAMBER_E2E_LIVE_GENESIS=1 to enable. Defaults skip in CI and locally.
const liveGenesisEnabled = process.env.CHAMBER_E2E_LIVE_GENESIS === '1';

test.describe('electron Genesis Lucy Chief of Staff chat smoke', () => {
  test.skip(!liveGenesisEnabled, 'Set CHAMBER_E2E_LIVE_GENESIS=1 to run the live Copilot Genesis Lucy CoS smoke.');
  test.setTimeout(360_000);

  let app: LaunchedElectronApp | undefined;
  let userDataPath = '';
  let genesisBasePath = '';
  let lucyPath = '';
  const tempRoots: string[] = [];

  test.beforeAll(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-genesis-lucy-cos-smoke-'));
    userDataPath = path.join(root, 'user-data');
    genesisBasePath = path.join(root, 'agents');
    lucyPath = path.join(genesisBasePath, 'lucy');
    tempRoots.push(root);

    app = await launchElectronApp({
      cdpPort,
      env: {
        CHAMBER_E2E_USER_DATA: userDataPath,
        CHAMBER_E2E_GENESIS_BASE_PATH: genesisBasePath,
        CHAMBER_E2E_GENESIS_MEMORY_APPEND: memoryInstruction,
      },
    });
  });

  test.afterAll(async () => {
    await app?.close();
    for (const root of tempRoots) {
      await removeTempRoot(root);
    }
  });

  test('creates Lucy as Chief of Staff through Genesis and uses working memory on the first chat turn', async () => {
    const page = await findRendererPage(app?.browser, app?.logs ?? []);
    await page.waitForLoadState('domcontentloaded');

    await page.getByRole('button', { name: /New Agent/i }).click();
    await page.getByRole('button', { name: 'Begin' }).click();
    await expect(page.getByRole('button', { name: /Lucy Chief of Staff/i })).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: /Lucy Chief of Staff/i }).click();

    await expect(page.getByText('How can I help you today?')).toBeVisible({ timeout: 300_000 });
    await expect(page.getByText(lucyName)).toBeVisible();
    await expect(page.getByPlaceholder('Message your agent… (paste an image to attach)')).toBeEnabled();

    expect(fs.existsSync(path.join(lucyPath, 'SOUL.md'))).toBe(true);
    expect(fs.readFileSync(path.join(lucyPath, 'SOUL.md'), 'utf-8')).toContain('I am Lucy, a calm and practical Chief of Staff.');
    expect(fs.readFileSync(path.join(lucyPath, '.working-memory', 'memory.md'), 'utf-8')).toContain(memoryInstruction);

    const result = await page.evaluate(async ({ expected, name }) => {
      const minds = await window.electronAPI.mind.list();
      const mind = minds.find((candidate) => candidate.identity.name === name);
      if (!mind) throw new Error(`Created mind ${name} was not loaded.`);

      const messageId = `genesis-lucy-cos-smoke-${Date.now()}`;
      const events: Array<{ type: string; content?: string; message?: string }> = [];
      let assistantText = '';
      let errorMessage = '';
      let resolveTerminal: () => void = () => undefined;
      const terminal = new Promise<void>((resolve) => {
        resolveTerminal = resolve;
      });
      const unsubscribe = window.electronAPI.chat.onEvent((mindId, receivedMessageId, event) => {
        if (mindId !== mind.mindId || receivedMessageId !== messageId) return;
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
          mind.mindId,
          `This is a live Chamber Lucy Chief of Staff smoke test. Reply with exactly ${expected} and no other text.`,
          messageId,
        );
        const timeout = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Timed out waiting for Lucy Chief of Staff smoke response.')), 180_000);
        });
        await Promise.race([Promise.all([send, terminal]), timeout]);
        return { mindName: mind.identity.name, assistantText, errorMessage, events };
      } finally {
        unsubscribe();
      }
    }, { expected: expectedReply, name: lucyName });

    expect(result.mindName).toBe(lucyName);
    expect(result.errorMessage).toBe('');
    expect(result.assistantText).toContain(expectedReply);
    expect(result.events.some((event) => event.type === 'done')).toBe(true);
  });
});

async function removeTempRoot(root: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM' || attempt === 9) {
        console.warn(`[genesis-lucy-cos-smoke] Failed to remove temp root ${root}:`, error);
        return;
      }
      await delay(250);
    }
  }
}
