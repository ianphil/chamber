import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { findRendererPage, launchElectronApp, type LaunchedElectronApp } from './electronApp';

const cdpPort = Number(process.env.CHAMBER_E2E_SETTINGS_ADD_ACCOUNT_CDP_PORT ?? 9343);
const mindName = 'Monica';

test.describe('electron Settings Add Account device-code smoke (#214)', () => {
  test.setTimeout(180_000);

  let app: LaunchedElectronApp | undefined;
  let mindPath = '';
  let userDataPath = '';
  const tempRoots: string[] = [];

  test.beforeAll(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-settings-add-account-smoke-'));
    mindPath = path.join(root, 'monica');
    userDataPath = path.join(root, 'user-data');
    tempRoots.push(root);
    seedMind(mindPath);

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

  test('+ Add Account opens a modal that displays the injected device code and dismisses on completion', async () => {
    const page = await findRendererPage(app?.browser, app?.logs ?? []);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#root')).not.toBeEmpty();

    await page.evaluate(async (pathToMind) => {
      const mind = await window.electronAPI.mind.add(pathToMind);
      await window.electronAPI.mind.setActive(mind.mindId);
    }, mindPath);

    await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    // Open the account dropdown and choose + Add Account.
    await page.getByRole('combobox').click();
    await page.getByRole('option', { name: '+ Add Account' }).click();

    // The bug fix: the modal must open and show the injected device code.
    const dialog = page.getByRole('dialog', { name: /Add a GitHub account/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/Starting authentication/i)).toBeVisible();

    await page.evaluate(() => {
      window.electronAPI.e2e?.emitAuthProgress({
        step: 'device_code',
        userCode: 'TEST-1234',
        verificationUri: 'https://github.com/login/device',
      });
    });

    await expect(dialog.getByText('TEST-1234')).toBeVisible();
    await expect(dialog.getByText('github.com/login/device')).toBeVisible();

    // Complete the stub login — modal must auto-dismiss.
    // (The full credential-store + dropdown refresh path is exercised in production
    //  by AuthService.storeCredential + auth:accountSwitched broadcast; we don't
    //  re-verify it here because E2E mode short-circuits before keytar.)
    await page.evaluate(() => {
      window.electronAPI.e2e?.completeLoginStub({ success: true, login: 'e2e-user' });
    });

    await expect(dialog).toBeHidden();
  });

  test('Cancel dismisses the modal and aborts the in-flight login', async () => {
    const page = await findRendererPage(app?.browser, app?.logs ?? []);
    await page.waitForLoadState('domcontentloaded');

    // Ensure no leftover dialog from a prior test is in the DOM.
    const leftover = page.getByRole('dialog');
    if (await leftover.count() > 0) {
      const cancel = leftover.getByRole('button', { name: 'Cancel' });
      if (await cancel.count() > 0) {
        await cancel.click();
        await expect(leftover).toBeHidden();
      }
    }

    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('combobox').click();
    await page.getByRole('option', { name: '+ Add Account' }).click();

    const dialog = page.getByRole('dialog', { name: /Add a GitHub account/i });
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
  });
});

function seedMind(seedPath: string): void {
  fs.mkdirSync(path.join(seedPath, '.github', 'agents'), { recursive: true });
  fs.mkdirSync(path.join(seedPath, '.working-memory'), { recursive: true });
  fs.writeFileSync(
    path.join(seedPath, 'SOUL.md'),
    [
      `# ${mindName}`,
      '',
      `${mindName} is a deterministic smoke-test mind for Settings add-account validation.`,
      '',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(seedPath, '.github', 'agents', 'monica.agent.md'),
    [
      '---',
      `name: ${mindName}`,
      'description: Chamber smoke-test settings add-account persona',
      '---',
      '',
      `# ${mindName} Agent`,
      '',
      'Help the user validate Settings add-account flows deterministically.',
      '',
    ].join('\n'),
  );
  for (const file of ['memory.md', 'rules.md', 'log.md']) {
    fs.writeFileSync(path.join(seedPath, '.working-memory', file), '');
  }
}

async function removeTempRoot(root: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM' || attempt === 9) {
        console.warn(`[settings-add-account-smoke] Failed to remove temp root ${root}:`, error);
        return;
      }
      await delay(250);
    }
  }
}
