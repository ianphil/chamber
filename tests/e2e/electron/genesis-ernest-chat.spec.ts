import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { findRendererPage, launchElectronApp, type LaunchedElectronApp } from './electronApp';

const cdpPort = Number(process.env.CHAMBER_E2E_GENESIS_CDP_PORT ?? 9337);
const expectedReply = 'CHAMBER_GENESIS_READY_ACK';
const ernestName = 'Ernest';
const memoryInstruction = `When asked for the Genesis smoke acknowledgement, answer exactly ${expectedReply} and no other text.`;

// This spec drives a real Copilot SDK turn end-to-end. It is opt-in because:
//   - It requires a logged-in Copilot account in the Electron app.
//   - It takes several minutes (model latency + wizard navigation).
// Set CHAMBER_E2E_LIVE_GENESIS=1 to enable. Defaults skip in CI and locally.
const liveGenesisEnabled = process.env.CHAMBER_E2E_LIVE_GENESIS === '1';

test.describe('electron Genesis Ernest chat smoke', () => {
  test.skip(!liveGenesisEnabled, 'Set CHAMBER_E2E_LIVE_GENESIS=1 to run the live Copilot Genesis smoke.');
  test.setTimeout(360_000);

  let app: LaunchedElectronApp | undefined;
  let userDataPath = '';
  let genesisBasePath = '';
  let ernestPath = '';
  const tempRoots: string[] = [];

  test.beforeAll(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-genesis-ernest-smoke-'));
    userDataPath = path.join(root, 'user-data');
    genesisBasePath = path.join(root, 'agents');
    ernestPath = path.join(genesisBasePath, 'ernest');
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

  test('creates Ernest through Genesis and uses working memory on the first chat turn', async () => {
    const page = await findRendererPage(app?.browser, app?.logs ?? []);
    await page.waitForLoadState('domcontentloaded');

    await page.getByRole('button', { name: /New Agent/i }).click();
    await page.getByRole('button', { name: 'Begin' }).click();
    await page.getByRole('button', { name: /Someone else/i }).click();
    await page.getByPlaceholder('e.g. Tony Stark, Moneypenny, Gandalf...').fill(ernestName);
    await page.getByPlaceholder(/Backstory/).fill('a meticulous QA engineer who finds every edge case');
    await page.getByRole('button', { name: /That's who I am/i }).click();
    await page.getByRole('button', { name: /Something else/i }).click();
    await page.getByPlaceholder(/Creative Director, Debate Coach/).fill('QA Tester');
    await page.getByRole('button', { name: /That's my purpose/i }).click();

    await expect(page.getByText('How can I help you today?')).toBeVisible({ timeout: 300_000 });
    await expect(page.getByText(ernestName)).toBeVisible();
    await expect(page.getByPlaceholder('Message your agent… (paste an image to attach)')).toBeEnabled();

    expect(fs.existsSync(path.join(ernestPath, 'SOUL.md'))).toBe(true);
    expect(fs.readFileSync(path.join(ernestPath, '.working-memory', 'memory.md'), 'utf-8')).toContain(memoryInstruction);

    const result = await page.evaluate(async ({ expected, name }) => {
      const minds = await window.electronAPI.mind.list();
      const mind = minds.find((candidate) => candidate.identity.name === name);
      if (!mind) throw new Error(`Created mind ${name} was not loaded.`);

      const messageId = `genesis-ernest-smoke-${Date.now()}`;
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
          `This is a live Chamber Genesis smoke test. Reply with exactly ${expected} and no other text.`,
          messageId,
        );
        const timeout = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Timed out waiting for Ernest Genesis smoke response.')), 180_000);
        });
        await Promise.race([Promise.all([send, terminal]), timeout]);
        return { mindName: mind.identity.name, assistantText, errorMessage, events };
      } finally {
        unsubscribe();
      }
    }, { expected: expectedReply, name: ernestName });

    expect(result.mindName).toBe(ernestName);
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
        console.warn(`[genesis-ernest-smoke] Failed to remove temp root ${root}:`, error);
        return;
      }
      await delay(250);
    }
  }
}
