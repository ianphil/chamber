import { expect, test, type Locator } from '@playwright/test';

// Smoke for the chatroom view + OrchestrationPicker. Verifies:
//   1. The Chatroom activity-bar entry navigates to the chatroom view.
//   2. All five orchestration modes render as toggleable buttons.
//   3. Switching modes flips aria-pressed exclusively (only one active).
//   4. Mode-specific config controls (Moderator / Start with / Manager)
//      surface when their mode is selected.
//   5. The active-mode description paragraph in the picker updates to
//      match the selected mode — proves the parent's onModeChange
//      propagates back into the rendered prop, not just the local
//      aria-pressed flip.
//
// Relies on the CHAMBER_E2E_FAKE_MINDS=e2e-monica,e2e-alice,e2e-bob seed
// configured in config/playwright.config.ts so the picker has multiple
// ready minds for the Moderator / Start with / Manager dropdowns.
//
// The chatroom send round-trip is intentionally NOT exercised here — the
// browser shell's chatroom API is fully stubbed in apps/web/src/browserApi.ts
// (returns empty arrays). Adding a real round-trip needs a chatroom transport
// in the browser API + ctx.sendChatroom in the server, which is a feature
// PR, not test infrastructure. Tracked as a follow-up.

const MODE_LABELS = ['Concurrent', 'Sequential', 'Group Chat', 'Handoff', 'Magentic'] as const;
type ModeLabel = typeof MODE_LABELS[number];

// Distinctive snippets from each mode's description paragraph in
// apps/web/src/renderer/components/chatroom/OrchestrationPicker.tsx. Used
// to prove the active-mode description re-renders when mode changes.
const MODE_DESCRIPTION_SNIPPETS: Record<ModeLabel, RegExp> = {
  Concurrent: /respond to every message simultaneously/,
  Sequential: /Agents respond in turn/,
  'Group Chat': /designated moderator agent/,
  Handoff: /pass control to a more suitable agent/,
  Magentic: /decomposes the goal into a task ledger/,
};

test.describe('web chatroom UI smoke', () => {
  test('opens chatroom, lists modes, and switches between strategies', async ({ page }) => {
    await page.goto('/?token=e2e-token');
    await expect(page.locator('#root')).not.toBeEmpty();

    await page.getByRole('button', { name: 'Chatroom' }).click();

    const picker = page.getByTestId('orchestration-picker');
    await expect(picker).toBeVisible();

    // Every documented mode renders as a button inside the picker, and the
    // count matches — guards against a sixth mode landing without test
    // coverage being updated.
    await expect(picker.getByRole('button')).toHaveCount(MODE_LABELS.length);
    for (const label of MODE_LABELS) {
      await expect(picker.getByRole('button', { name: label })).toBeVisible();
    }

    // Concurrent is the default — it should be the only pressed button and
    // its description should be the rendered one.
    await expectExclusivePressed(picker, 'Concurrent');
    await expect(picker.getByText(MODE_DESCRIPTION_SNIPPETS.Concurrent)).toBeVisible();

    // Switch to Group Chat — Moderator selector should appear, description
    // updates, and Concurrent is no longer pressed.
    await picker.getByRole('button', { name: 'Group Chat' }).click();
    await expectExclusivePressed(picker, 'Group Chat');
    await expect(picker.getByText('Moderator:')).toBeVisible();
    await expect(picker.getByText(MODE_DESCRIPTION_SNIPPETS['Group Chat'])).toBeVisible();

    // Switch to Handoff — initial-agent selector swaps in, Moderator is gone.
    await picker.getByRole('button', { name: 'Handoff' }).click();
    await expectExclusivePressed(picker, 'Handoff');
    await expect(picker.getByText('Start with:')).toBeVisible();
    await expect(picker.getByText('Moderator:')).toHaveCount(0);
    await expect(picker.getByText(MODE_DESCRIPTION_SNIPPETS.Handoff)).toBeVisible();

    // Switch to Magentic — manager selector appears.
    await picker.getByRole('button', { name: 'Magentic' }).click();
    await expectExclusivePressed(picker, 'Magentic');
    await expect(picker.getByText('Manager:')).toBeVisible();
    await expect(picker.getByText(MODE_DESCRIPTION_SNIPPETS.Magentic)).toBeVisible();

    // Sequential has no extra selectors — verify the toggle still works and
    // the previous selectors disappear.
    await picker.getByRole('button', { name: 'Sequential' }).click();
    await expectExclusivePressed(picker, 'Sequential');
    await expect(picker.getByText('Manager:')).toHaveCount(0);
    await expect(picker.getByText(MODE_DESCRIPTION_SNIPPETS.Sequential)).toBeVisible();
  });
});

async function expectExclusivePressed(picker: Locator, expectedLabel: ModeLabel): Promise<void> {
  for (const label of MODE_LABELS) {
    await expect(picker.getByRole('button', { name: label })).toHaveAttribute(
      'aria-pressed',
      label === expectedLabel ? 'true' : 'false',
    );
  }
}
