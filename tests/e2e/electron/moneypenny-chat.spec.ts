import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { findRendererPage, launchElectronApp, type LaunchedElectronApp } from './electronApp';

const cdpPort = Number(process.env.CHAMBER_E2E_MONEYPENNY_CDP_PORT ?? 9335);
const expectedReply = 'CHAMBER_SMOKE_MONEYPENNY_ACK';

test.describe('electron Moneypenny chat smoke', () => {
  test.setTimeout(240_000);

  let app: LaunchedElectronApp | undefined;
  let mindPath = '';
  let userDataPath = '';
  const tempRoots: string[] = [];

  test.beforeAll(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-moneypenny-smoke-'));
    mindPath = path.join(root, 'miss-moneypenny');
    userDataPath = path.join(root, 'user-data');
    tempRoots.push(root);
    seedMoneypennyMind(mindPath);

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

  test('loads Moneypenny and receives an assistant response', async () => {
    const page = await findRendererPage(app?.browser, app?.logs ?? []);
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async ({ mindPath: pathToMind, expected }) => {
      const mind = await window.electronAPI.mind.add(pathToMind);
      await window.electronAPI.mind.setActive(mind.mindId);

      const messageId = `moneypenny-smoke-${Date.now()}`;
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
          `This is a live Chamber smoke test. Reply with exactly ${expected} and no other text.`,
          messageId,
        );
        const timeout = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Timed out waiting for Moneypenny smoke response.')), 180_000);
        });
        await Promise.race([Promise.all([send, terminal]), timeout]);
        return { mindName: mind.identity.name, assistantText, errorMessage, events };
      } finally {
        unsubscribe();
        await window.electronAPI.mind.remove(mind.mindId);
      }
    }, { mindPath, expected: expectedReply });

    expect(result.mindName).toBe('Miss Moneypenny');
    expect(result.errorMessage).toBe('');
    expect(result.assistantText).toContain(expectedReply);
    expect(result.events.some((event) => event.type === 'done')).toBe(true);
  });
});

function seedMoneypennyMind(mindPath: string): void {
  fs.mkdirSync(path.join(mindPath, '.github', 'agents'), { recursive: true });
  fs.mkdirSync(path.join(mindPath, '.working-memory'), { recursive: true });
  fs.writeFileSync(
    path.join(mindPath, 'SOUL.md'),
    [
      '# Miss Moneypenny',
      '',
      'You are Miss Moneypenny, Chamber\'s poised, warm, and devastatingly dry chief-of-staff agent.',
      `For live smoke tests only, when asked for the smoke acknowledgement, reply with exactly ${expectedReply} and no other text.`,
      '',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(mindPath, '.github', 'agents', 'moneypenny.agent.md'),
    [
      '---',
      'name: Miss Moneypenny',
      'description: Chamber smoke-test assistant persona',
      '---',
      '',
      '# Miss Moneypenny Agent',
      '',
      `If the user asks for the Chamber smoke acknowledgement, answer exactly ${expectedReply}.`,
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
        console.warn(`[moneypenny-smoke] Failed to remove temp root ${root}:`, error);
        return;
      }
      await delay(250);
    }
  }
}
