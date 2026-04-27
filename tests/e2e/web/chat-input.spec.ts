import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Exercises the real chat textarea + send keypath through the loopback
// fake-chat server. Complements browser-loopback-chat.spec.ts, which drives
// the underlying IPC via window.electronAPI.chat.send and bypasses the UI.

const expectedReply = 'CHAMBER_BROWSER_LOOPBACK_ACK';

test.describe('web chat input UI smoke', () => {
  let root = '';
  let mindPath = '';

  test.beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-chat-input-smoke-'));
    mindPath = path.join(root, 'monica-input');
    seedMind(mindPath);
  });

  test.afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('types into the textarea, sends with Enter, and renders the assistant reply', async ({ page }) => {
    await page.goto('/?token=e2e-token');
    await expect(page.locator('#root')).not.toBeEmpty();

    // Seed the fake-chat server with a mind via IPC, then reload so the
    // GenesisGate's mount-time mind.list() picks it up and lifts.
    // (browserApi.ts wires onMindChanged to a no-op, so post-mount add
    // does not retroactively unblock the gate.)
    const mindId = await page.evaluate(async (pathToMind) => {
      const mind = await window.electronAPI.mind.add(pathToMind);
      return mind.mindId;
    }, mindPath);
    expect(mindId).toBeTruthy();

    await page.reload();
    await expect(page.locator('#root')).not.toBeEmpty();

    const textarea = page.getByPlaceholder('Message your agent… (paste an image to attach)');
    await expect(textarea).toBeEnabled({ timeout: 15_000 });

    await textarea.click();
    await textarea.fill('This is a chat input UI smoke. Reply with the loopback ack.');
    await textarea.press('Enter');

    // The fake-chat server publishes the configured reply as a single
    // message_final event. The renderer should append an assistant message
    // containing that text.
    await expect(page.getByText(expectedReply, { exact: false })).toBeVisible({ timeout: 15_000 });

    // After the turn finishes the textarea should be re-enabled and empty.
    await expect(textarea).toBeEnabled();
    await expect(textarea).toHaveValue('');
  });
});

function seedMind(rootPath: string): void {
  fs.mkdirSync(path.join(rootPath, '.github', 'agents'), { recursive: true });
  fs.writeFileSync(
    path.join(rootPath, 'SOUL.md'),
    [
      '# Monica Input',
      '',
      'A deterministic local mind used by the chat-input UI smoke test.',
      '',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(rootPath, '.github', 'agents', 'monica-input.agent.md'),
    [
      '---',
      'name: Monica Input',
      'description: Chat-input UI smoke persona',
      '---',
      '',
      '# Monica Input Agent',
      '',
      'Exercise the textarea + send-button path without requiring a live model turn.',
      '',
    ].join('\n'),
  );
}
