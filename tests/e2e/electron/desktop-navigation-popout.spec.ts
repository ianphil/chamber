import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { findRendererPage, launchElectronApp, type LaunchedElectronApp } from './electronApp';

const cdpPort = Number(process.env.CHAMBER_E2E_DESKTOP_NAV_CDP_PORT ?? 9339);
const chatStateChannel = 'chamber:chatState:v1';

test.describe('electron desktop navigation and popout smoke', () => {
  test.setTimeout(180_000);

  let app: LaunchedElectronApp | undefined;
  let userDataPath = '';
  let externalMindPath = '';
  let popoutMindPath = '';
  const tempRoots: string[] = [];

  test.beforeAll(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-desktop-nav-smoke-'));
    userDataPath = path.join(root, 'user-data');
    externalMindPath = path.join(root, 'external-link-mind');
    popoutMindPath = path.join(root, 'popout-continuity-mind');
    tempRoots.push(root);
    seedMind(externalMindPath, 'External Link Smoke Mind');
    seedMind(popoutMindPath, 'Popout Continuity Smoke Mind');

    app = await launchElectronApp({
      cdpPort,
      env: {
        CHAMBER_E2E_USER_DATA: userDataPath,
        CHAMBER_E2E_DISABLE_OPEN_EXTERNAL: '1',
      },
    });
  });

  test.afterAll(async () => {
    await app?.close();
    for (const root of tempRoots) {
      await removeTempRoot(root);
    }
  });

  test('keeps Chamber focused when an agent message opens an external link', async () => {
    const page = await findRendererPage(app?.browser, app?.logs ?? []);
    await page.waitForLoadState('domcontentloaded');
    const mind = await loadMindInRenderer(page, externalMindPath, /External Link Smoke Mind/);
    const initialUrl = page.url();

    await hydrateChatState(page, mind.mindId, 'external-link-message', 'Open [external smoke link](https://example.com/chamber-smoke) please.');
    const link = page.getByRole('link', { name: 'external smoke link' });
    await expect(link).toBeVisible();

    await link.click();
    await delay(500);

    expect(page.url()).toBe(initialUrl);
    await expect(page.locator('#root')).not.toBeEmpty();
    await expect(link).toBeVisible();
  });

  test('keeps chat messages visible in a popout and after it closes', async () => {
    const page = await findRendererPage(app?.browser, app?.logs ?? []);
    await page.waitForLoadState('domcontentloaded');
    const mind = await loadMindInRenderer(page, popoutMindPath, /Popout Continuity Smoke Mind/);
    const message = 'Popout continuity smoke transcript';

    await hydrateChatState(page, mind.mindId, 'popout-continuity-message', message);
    await expect(page.getByText(message)).toBeVisible();

    await page.evaluate((mindId) => window.electronAPI.mind.openWindow(mindId), mind.mindId);
    const popout = await waitForPopoutPage(mind.mindId);
    await popout.waitForLoadState('domcontentloaded');
    await expect(popout.getByText(message)).toBeVisible();

    await popout.close();
    await expect.poll(
      () => page.evaluate(() => window.electronAPI.mind.list().then((minds) => minds.every((mind) => !mind.windowed))),
      { timeout: 10_000 },
    ).toBe(true);
    await expect(page.getByText(message)).toBeVisible();
  });

  async function waitForPopoutPage(mindId: string): Promise<Page> {
    const browser = app?.browser;
    if (!browser) throw new Error('Browser was not connected.');
    await expect.poll(() => {
      for (const context of browser.contexts()) {
        const page = context.pages().find((candidate) => {
          const url = candidate.url();
          return url.includes('popout=true') && url.includes(`mindId=${mindId}`);
        });
        if (page) return true;
      }
      return false;
    }, { timeout: 10_000 }).toBe(true);

    for (const context of browser.contexts()) {
      const page = context.pages().find((candidate) => {
        const url = candidate.url();
        return url.includes('popout=true') && url.includes(`mindId=${mindId}`);
      });
      if (page) return page;
    }
    throw new Error(`Timed out waiting for popout page for ${mindId}.`);
  }
});

async function loadMindInRenderer(page: Page, mindPath: string, buttonName: RegExp) {
  const mind = await page.evaluate(async (pathToMind) => {
    const loaded = await window.electronAPI.mind.add(pathToMind);
    await window.electronAPI.mind.setActive(loaded.mindId);
    return loaded;
  }, mindPath);
  await page.getByRole('button', { name: buttonName }).click();
  await expect(page.getByPlaceholder('Message your agent… (paste an image to attach)')).toBeEnabled();
  return mind;
}

async function hydrateChatState(page: Page, mindId: string, messageId: string, content: string): Promise<void> {
  await page.evaluate(({ channelName, mindId, messageId, content }) => {
    const channel = new BroadcastChannel(channelName);
    channel.postMessage({
      type: 'state',
      payload: {
        messagesByMind: {
          [mindId]: [{
            id: messageId,
            role: 'assistant',
            blocks: [{ type: 'text', content }],
            timestamp: Date.now(),
          }],
        },
        streamingByMind: { [mindId]: false },
      },
    });
    channel.close();
  }, { channelName: chatStateChannel, mindId, messageId, content });
  await expect(page.getByText(content.replace(/\[([^\]]+)\]\([^)]+\)/, '$1'))).toBeVisible();
}

function seedMind(root: string, name: string): void {
  fs.mkdirSync(path.join(root, '.github', 'agents'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'SOUL.md'),
    [
      `# ${name}`,
      '',
      'A deterministic mind used by Electron desktop navigation smoke tests.',
      '',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(root, '.github', 'agents', `${slugify(name)}.agent.md`),
    [
      '---',
      `name: ${name}`,
      'description: Desktop navigation smoke-test persona',
      '---',
      '',
      `# ${name}`,
      '',
    ].join('\n'),
  );
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function removeTempRoot(root: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM' || attempt === 9) {
        console.warn(`[desktop-navigation-smoke] Failed to remove temp root ${root}:`, error);
        return;
      }
      await delay(250);
    }
  }
}
