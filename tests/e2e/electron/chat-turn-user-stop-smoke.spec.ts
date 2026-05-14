import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { findRendererPage, launchElectronApp, type LaunchedElectronApp } from './electronApp';

// Regression smoke for #222: the user - not a wall-clock - owns when a
// long-running agent turn ends. There is no fallback turn-deadline timer
// in ChatService anymore. This spec proves the contract end-to-end with
// the real Copilot SDK runtime: real CLI subprocess, real session, real
// WS event channel, real renderer, real DOM clicks.
//
// What we assert (no mocks, no fakes, no env knobs):
//   1. A streaming turn shows the Stop button (isStreaming === true).
//   2. After several seconds with no user action, streaming is STILL active
//      - there is no falsely-injected `done`/`timeout` event from a hidden
//      Chamber-side deadline. The user has not chosen to stop.
//   3. Pressing the Stop button cleanly aborts: the Stop button disappears,
//      the textarea is enabled again, and no error block is rendered.
//   4. Conversation history can switch away and resume the stopped session,
//      proving the streaming guard cleared instead of locking history.
const cdpPort = Number(process.env.CHAMBER_E2E_USER_STOP_CDP_PORT ?? 9362);

test.describe('electron chat turn user-controlled stop smoke', () => {
  test.setTimeout(180_000);

  let app: LaunchedElectronApp | undefined;
  let root = '';
  let userDataPath = '';

  test.afterEach(async () => {
    await app?.close();
    app = undefined;
    if (root) await removeTempRoot(root);
  });

  test('long real turn keeps streaming until the user presses Stop (#222)', async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-turn-user-stop-smoke-'));
    userDataPath = path.join(root, 'user-data');
    const mindPath = path.join(root, 'heinz-doofenshmirtz');
    seedMind(mindPath, 'Heinz Doofenshmirtz');

    app = await launchElectronApp({
      cdpPort,
      env: { CHAMBER_E2E_USER_DATA: userDataPath },
    });
    const page = await findRendererPage(app.browser, app.logs);
    await waitForMindApi(page);
    const mind = await loadAndActivateMind(page, mindPath, 'Heinz Doofenshmirtz');

    // Real interaction: click into the textarea, type a deliberately
    // verbose prompt so the SDK is comfortably busy for the duration of
    // the test, then press Enter.
    const textarea = page.getByPlaceholder('Message your agent… (paste an image to attach)');
    await expect(textarea).toBeEnabled();
    await textarea.click();
    await textarea.fill(
      'Think carefully step by step, then output a numbered list from 1 ' +
      'through 5000. Each item should be a complete sentence about Perry ' +
      'the Platypus and inator safety. Do not summarize or skip numbers.',
    );
    await textarea.press('Enter');

    // Stop button appears once isStreaming flips true — the user's
    // explicit signal that "the agent is working, you can stop it."
    const stopButton = page.getByRole('button', { name: 'Stop streaming' });
    await expect(stopButton).toBeVisible({ timeout: 10_000 });

    // Wait several seconds while doing nothing. Pre-#222 fix: a hidden
    // 5-minute Chamber timer would not fire here, but any shorter Chamber
    // deadline would falsely terminate the turn. Post-#222 fix: there is
    // no Chamber deadline at all. The Stop button must remain visible
    // because the user has not chosen to stop and the SDK hasn't idled.
    await page.waitForTimeout(5_000);
    await expect(stopButton).toBeVisible();
    await expect(page.getByText(/Agent timed out after/i)).toHaveCount(0);
    await expect(page.getByText(/^Error:/)).toHaveCount(0);

    // The user's contract: click Stop, get clean abort.
    await stopButton.click();

    // Stop button disappears (isStreaming cleared) and the textarea is
    // ready for the next prompt. No error or timeout block was rendered.
    await expect(stopButton).toHaveCount(0, { timeout: 10_000 });
    await expect(textarea).toBeEnabled();
    await expect(page.getByText(/Agent timed out after/i)).toHaveCount(0);
    await expect(page.getByText(/^Error:/)).toHaveCount(0);

    const stoppedSessionId = await activeConversationSessionId(page, mind.mindId);
    const newSessionId = await page.evaluate(async (mindId) => {
      const result = await window.electronAPI.chat.newConversation(mindId);
      return result.sessionId;
    }, mind.mindId);
    expect(newSessionId).not.toBe(stoppedSessionId);

    const resumedSessionId = await page.evaluate(async ({ mindId, sessionId }) => {
      const result = await window.electronAPI.conversationHistory.resume(mindId, sessionId);
      return result.sessionId;
    }, { mindId: mind.mindId, sessionId: stoppedSessionId });
    expect(resumedSessionId).toBe(stoppedSessionId);
    await expect(page.getByText(/Cannot switch conversations while a message is still streaming/i)).toHaveCount(0);

    // Sanity: a follow-up send should work — the per-mind TurnQueue was
    // released cleanly by the abort.
    await textarea.click();
    await textarea.fill(
      'Start another long numbered list from 1 through 1000 about clean ' +
      'abort handling. Do not summarize or skip numbers.',
    );
    await textarea.press('Enter');
    await expect(stopButton).toBeVisible({ timeout: 10_000 });
    await stopButton.click();
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

async function loadAndActivateMind(page: Page, mindPath: string, name: string) {
  const mind = await page.evaluate(async (pathToMind) => {
    const loaded = await window.electronAPI.mind.add(pathToMind);
    await window.electronAPI.mind.setActive(loaded.mindId);
    return loaded;
  }, mindPath);
  const mindButton = page.getByRole('button', { name }).first();
  await mindButton.click();
  await expect(mindButton).toHaveClass(/bg-accent/);
  return mind;
}

async function activeConversationSessionId(page: Page, mindId: string): Promise<string> {
  const getActiveSessionId = () => page.evaluate(async (activeMindId) => {
    const conversations = await window.electronAPI.conversationHistory.list(activeMindId);
    return conversations.find((conversation) => conversation.active)?.sessionId ?? '';
  }, mindId);

  await expect.poll(
    getActiveSessionId,
    { timeout: 10_000 },
  ).not.toBe('');
  return getActiveSessionId();
}

function seedMind(root: string, name: string): void {
  fs.mkdirSync(path.join(root, '.github', 'agents'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'SOUL.md'),
    [
      `# ${name}`,
      '',
      'A deterministic mind used by the chat user-controlled stop smoke (#222).',
      '',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(root, '.github', 'agents', 'heinz-doofenshmirtz.agent.md'),
    [
      '---',
      `name: ${name}`,
      'description: User-controlled stop smoke-test persona',
      '---',
      '',
      `# ${name}`,
      '',
      'Reply at length when asked to think carefully so smoke tests can',
      'observe the streaming/stop lifecycle.',
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
        console.warn(`[chat-turn-user-stop-smoke] Failed to remove temp root ${root}:`, error);
        return;
      }
      await delay(250);
    }
  }
}
