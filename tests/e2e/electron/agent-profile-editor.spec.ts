import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { findRendererPage, launchElectronApp, type LaunchedElectronApp } from './electronApp';

const cdpPort = Number(process.env.CHAMBER_E2E_PROFILE_CDP_PORT ?? 9347);
const mindName = 'Profile Smoke Mind';

test.describe('electron agent profile editor smoke', () => {
  test.setTimeout(180_000);

  let app: LaunchedElectronApp | undefined;
  let mindPath = '';
  let userDataPath = '';
  const tempRoots: string[] = [];

  test.beforeAll(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-agent-profile-smoke-'));
    mindPath = path.join(root, 'profile-smoke');
    userDataPath = path.join(root, 'user-data');
    tempRoots.push(root);
    seedMind(mindPath, mindName);

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

  test('edits SOUL.md through the profile modal and prompts for restart', async () => {
    const page = await findRendererPage(app?.browser, app?.logs ?? []);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => Boolean(window.electronAPI?.mind?.add));

    await page.evaluate(async ({ targetMindPath }) => {
      const mind = await window.electronAPI.mind.add(targetMindPath);
      await window.electronAPI.mind.setActive(mind.mindId);
    }, { targetMindPath: mindPath });

    await expect(page.getByText('How can I help you today?')).toBeVisible();
    await page.getByRole('button', { name: `Edit ${mindName} profile`, exact: true }).click();
    await expect(page.getByRole('dialog').getByText('Agent profile')).toBeVisible();

    await page.getByRole('button', { name: /SOUL.md/ }).click();
    const editor = page.getByRole('textbox');
    await editor.fill(`# ${mindName}\n\nEdited through the Chamber profile smoke.`);
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByRole('button', { name: 'Restart agent to apply' })).toBeVisible();
    expect(fs.readFileSync(path.join(mindPath, 'SOUL.md'), 'utf-8')).toContain('Edited through the Chamber profile smoke.');
  });
});

function seedMind(root: string, name: string): void {
  fs.mkdirSync(path.join(root, '.github', 'agents'), { recursive: true });
  fs.mkdirSync(path.join(root, '.working-memory'), { recursive: true });
  fs.writeFileSync(path.join(root, 'SOUL.md'), `# ${name}\n\nOriginal profile.`);
  fs.writeFileSync(
    path.join(root, '.github', 'agents', 'profile-smoke.agent.md'),
    ['---', `name: ${name}`, '---', '', `# ${name} Agent`, ''].join('\n'),
  );
  for (const file of ['memory.md', 'rules.md', 'log.md']) {
    fs.writeFileSync(path.join(root, '.working-memory', file), '');
  }
}

async function removeTempRoot(root: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM' || attempt === 9) {
        console.warn(`[agent-profile-smoke] Failed to remove temp root ${root}:`, error);
        return;
      }
      await delay(250);
    }
  }
}
