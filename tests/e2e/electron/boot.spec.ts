import { expect, test, type Browser } from '@playwright/test';

import { findRendererPage, launchElectronApp, type LaunchedElectronApp } from './electronApp';

const cdpPort = Number(process.env.CHAMBER_E2E_CDP_PORT ?? 9333);
const cdpUrl = process.env.CHAMBER_E2E_CDP_URL ?? `http://127.0.0.1:${cdpPort}`;

test.describe('electron app boot', () => {
  test.setTimeout(180_000);

  let app: LaunchedElectronApp | undefined;
  let browser: Browser | undefined;

  test.beforeAll(async () => {
    app = await launchElectronApp({ cdpPort, cdpUrl: process.env.CHAMBER_E2E_CDP_URL ? cdpUrl : undefined });
    browser = app.browser;
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test('exposes preload bridges and renders non-empty content', async () => {
    const page = await findRendererPage(browser, app?.logs ?? []);
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });

    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#root')).not.toBeEmpty();

    await expect(page.evaluate(() => typeof window.electronAPI)).resolves.toBe('object');
    await expect(page.evaluate(() => typeof window.desktop)).resolves.toBe('object');
    expect(app?.logs.join('\n') ?? '').not.toMatch(/Pre-transform error|Cannot assign to read only property|Failed to load url/i);
    expect(consoleErrors, `console errors: ${consoleErrors.join('\n')}`).toEqual([]);
  });
});
