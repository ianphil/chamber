import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const expectedReply = 'CHAMBER_BROWSER_LOOPBACK_ACK';

test.describe('web browser loopback chat smoke', () => {
  let root = '';
  let mindPath = '';

  test.beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-browser-chat-smoke-'));
    mindPath = path.join(root, 'monica-browser');
    seedBrowserMind(mindPath);
  });

  test.afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('adds a local mind and receives chat events over the loopback WebSocket', async ({ page }) => {
    await page.goto('/?token=e2e-token');
    await expect(page.locator('#root')).not.toBeEmpty();

    const result = await page.evaluate(async ({ pathToMind, expected }) => {
      const mind = await window.electronAPI.mind.add(pathToMind);
      const messageId = `browser-loopback-smoke-${Date.now()}`;
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
          `This is a browser loopback smoke test. Reply with ${expected}.`,
          messageId,
        );
        const timeout = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Timed out waiting for browser loopback chat events.')), 10_000);
        });
        await Promise.race([Promise.all([send, terminal]), timeout]);
        return { mindName: mind.identity.name, assistantText, errorMessage, events };
      } finally {
        unsubscribe();
      }
    }, { pathToMind: mindPath, expected: expectedReply });

    expect(result.mindName).toBe('monica-browser');
    expect(result.errorMessage).toBe('');
    expect(result.assistantText).toContain(expectedReply);
    expect(result.events.some((event) => event.type === 'done')).toBe(true);
  });
});

function seedBrowserMind(rootPath: string): void {
  fs.mkdirSync(path.join(rootPath, '.github', 'agents'), { recursive: true });
  fs.writeFileSync(
    path.join(rootPath, 'SOUL.md'),
    [
      '# Monica Browser',
      '',
      'A deterministic local mind used by the browser loopback chat smoke test.',
      '',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(rootPath, '.github', 'agents', 'monica-browser.agent.md'),
    [
      '---',
      'name: Monica Browser',
      'description: Browser loopback smoke-test persona',
      '---',
      '',
      '# Monica Browser Agent',
      '',
      'Exercise the browser loopback transport without requiring a live model turn.',
      '',
    ].join('\n'),
  );
}
