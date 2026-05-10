import { expect, test } from '@playwright/test';

// Exercises the real chat textarea + send keypath through the loopback
// fake-chat server. Complements browser-loopback-chat.spec.ts, which drives
// the underlying IPC via window.electronAPI.chat.send and bypasses the UI.
//
// Relies on the CHAMBER_E2E_FAKE_MINDS=e2e-monica,e2e-alice,e2e-bob seed
// configured in config/playwright.config.ts — `e2e-monica` is the first
// seeded mind and becomes the active mind on mount via useAgentStatus.

const expectedReply = 'CHAMBER_BROWSER_LOOPBACK_ACK';

test.describe('web chat input UI smoke', () => {
  test('types into the textarea, sends with Enter, and renders the assistant reply', async ({ page }) => {
    await page.goto('/?token=e2e-token');
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
