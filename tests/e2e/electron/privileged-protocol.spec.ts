import { expect, test } from '@playwright/test';

import { findRendererPage, launchElectronApp, type LaunchedElectronApp } from './electronApp';

const cdpPort = Number(process.env.CHAMBER_E2E_PRIVILEGED_CDP_PORT ?? 9334);
const token = 'e2e-privileged-token';

test.describe('electron privileged loopback channel', () => {
  test.setTimeout(180_000);

  let app: LaunchedElectronApp | undefined;

  test.beforeAll(async () => {
    app = await launchElectronApp({
      cdpPort,
      env: {
        CHAMBER_MVP_SERVER: '1',
        CHAMBER_SERVER_TOKEN: token,
      },
    });
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test('rejects malformed credential requests through the app-spawned server', async () => {
    const page = await findRendererPage(app?.browser, app?.logs ?? []);
    await page.waitForLoadState('domcontentloaded');

    const baseUrl = new URL(page.url()).origin;
    const response = await fetch(`${baseUrl}/api/privileged`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        origin: 'http://127.0.0.1',
      },
      body: JSON.stringify({
        protoVersion: 1,
        type: 'credential.setPassword',
        requestId: 'smoke-credential-set',
        payload: { service: 'copilot-cli', account: 'octocat' },
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'credential.setPassword requires payload.password.',
    });
  });
});
