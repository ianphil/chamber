import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Smoke for the chatroom view + OrchestrationPicker. Verifies:
//   1. The Chatroom activity-bar entry navigates to the chatroom view.
//   2. All five orchestration modes render as toggleable buttons.
//   3. Switching modes flips aria-pressed on the active button.
//   4. Mode-specific config controls (Moderator / Start with / Manager)
//      surface when their mode is selected.
//
// The chatroom send path is intentionally not exercised here — the fake-chat
// server only stubs single-mind chat (ctx.sendChat) and does not yet stub
// chatroom orchestration. A follow-up issue should add ctx.sendChatroom and
// extend this spec with a multi-agent round.

const MODE_LABELS = ['Concurrent', 'Sequential', 'Group Chat', 'Handoff', 'Magentic'] as const;

test.describe('web chatroom UI smoke', () => {
  let root = '';
  const mindPaths: string[] = [];

  test.beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-chatroom-ui-smoke-'));
    mindPaths.length = 0;
    for (const name of ['alice', 'bob']) {
      const mindPath = path.join(root, name);
      seedMind(mindPath, name);
      mindPaths.push(mindPath);
    }
  });

  test.afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('opens chatroom, lists modes, and switches between strategies', async ({ page }) => {
    await page.goto('/?token=e2e-token');
    await expect(page.locator('#root')).not.toBeEmpty();

    // Seed the fake-chat server with two minds so the mode-specific
    // selectors (Moderator / Start with / Manager) have participants to
    // render. Reload so GenesisGate's mount-time mind.list() picks them up.
    // (browserApi.ts wires onMindChanged to a no-op, so post-mount add
    // does not retroactively unblock the gate.)
    for (const mindPath of mindPaths) {
      await page.evaluate((pathToMind) => window.electronAPI.mind.add(pathToMind), mindPath);
    }

    await page.reload();
    await expect(page.locator('#root')).not.toBeEmpty();

    await page.getByRole('button', { name: 'Chatroom' }).click();

    const picker = page.getByTestId('orchestration-picker');
    await expect(picker).toBeVisible();

    // Every documented mode renders as a button inside the picker.
    for (const label of MODE_LABELS) {
      await expect(picker.getByRole('button', { name: label })).toBeVisible();
    }

    // Concurrent is the default — it should report aria-pressed=true.
    await expect(picker.getByRole('button', { name: 'Concurrent' })).toHaveAttribute('aria-pressed', 'true');

    // Switch to Group Chat — Moderator selector should appear.
    await picker.getByRole('button', { name: 'Group Chat' }).click();
    await expect(picker.getByRole('button', { name: 'Group Chat' })).toHaveAttribute('aria-pressed', 'true');
    await expect(picker.getByText('Moderator:')).toBeVisible();

    // Switch to Handoff — initial-agent selector swaps in.
    await picker.getByRole('button', { name: 'Handoff' }).click();
    await expect(picker.getByRole('button', { name: 'Handoff' })).toHaveAttribute('aria-pressed', 'true');
    await expect(picker.getByText('Start with:')).toBeVisible();
    await expect(picker.getByText('Moderator:')).toHaveCount(0);

    // Switch to Magentic — manager selector appears.
    await picker.getByRole('button', { name: 'Magentic' }).click();
    await expect(picker.getByRole('button', { name: 'Magentic' })).toHaveAttribute('aria-pressed', 'true');
    await expect(picker.getByText('Manager:')).toBeVisible();

    // Sequential and Concurrent have no extra selectors — just verify the
    // toggle still works and the previous selectors disappear.
    await picker.getByRole('button', { name: 'Sequential' }).click();
    await expect(picker.getByRole('button', { name: 'Sequential' })).toHaveAttribute('aria-pressed', 'true');
    await expect(picker.getByText('Manager:')).toHaveCount(0);
  });
});

function seedMind(rootPath: string, name: string): void {
  fs.mkdirSync(path.join(rootPath, '.github', 'agents'), { recursive: true });
  fs.writeFileSync(
    path.join(rootPath, 'SOUL.md'),
    [`# ${name}`, '', `A deterministic local mind for the chatroom UI smoke.`, ''].join('\n'),
  );
  fs.writeFileSync(
    path.join(rootPath, '.github', 'agents', `${name}.agent.md`),
    [
      '---',
      `name: ${name}`,
      'description: Chatroom UI smoke persona',
      '---',
      '',
      `# ${name} Agent`,
      '',
      'Provide chatroom participants for orchestration picker rendering.',
      '',
    ].join('\n'),
  );
}
