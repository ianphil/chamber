import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { findRendererPage, launchElectronApp, type LaunchedElectronApp } from './electronApp';

const cdpPort = Number(process.env.CHAMBER_E2E_LENS_CDP_PORT ?? 9336);
const smokeViewId = 'smoke-hotload';
const refreshViewId = 'smoke-refresh-continuity';
const canvasSmokeViewId = 'canvas-smoke';

test.describe('electron Lens hot-load smoke', () => {
  test.setTimeout(180_000);

  let app: LaunchedElectronApp | undefined;
  let mindPath = '';
  let inactiveMindPath = '';
  let userDataPath = '';
  const tempRoots: string[] = [];

  test.beforeAll(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-lens-smoke-'));
    mindPath = path.join(root, 'lens-smoke-mind');
    inactiveMindPath = path.join(root, 'inactive-lens-smoke-mind');
    userDataPath = path.join(root, 'user-data');
    tempRoots.push(root);
    seedMind(mindPath, 'Active Lens Smoke Mind');
    seedMind(inactiveMindPath, 'Inactive Lens Smoke Mind');
    writeLensView(inactiveMindPath);

    app = await launchElectronApp({
      cdpPort,
      env: {
        CHAMBER_E2E_USER_DATA: userDataPath,
        CHAMBER_E2E_LENS_REFRESH_DELAY_MS: '1000',
        CHAMBER_E2E_LENS_REFRESH_JSON: JSON.stringify({ status: 'fresh' }),
      },
    });
  });

  test.afterAll(async () => {
    await app?.close();
    for (const root of tempRoots) {
      await removeTempRoot(root);
    }
  });

  test('hot-loads created and deleted Lens views without restarting Electron', async () => {
    const page = await findRendererPage(app?.browser, app?.logs ?? []);
    await page.waitForLoadState('domcontentloaded');

    const mind = await page.evaluate(async ({ pathToMind, pathToInactiveMind }) => {
      const loaded = await window.electronAPI.mind.add(pathToMind);
      await window.electronAPI.mind.add(pathToInactiveMind);
      await window.electronAPI.mind.setActive(loaded.mindId);
      return loaded;
    }, { pathToMind: mindPath, pathToInactiveMind: inactiveMindPath });

    await page.getByRole('button', { name: /Active Lens Smoke Mind/ }).click();

    await page.evaluate(() => {
      const target = window as typeof window & { __lensHotloadEvents?: string[][] };
      target.__lensHotloadEvents = [];
      window.electronAPI.lens.onViewsChanged((views) => {
        target.__lensHotloadEvents?.push(views.map((view) => view.id));
      });
    });

    await expect.poll(
      () => page.evaluate(async ({ mindId, viewId }) => {
        const views = await window.electronAPI.lens.getViews(mindId);
        return views.some((view) => view.id === viewId);
       }, { mindId: mind.mindId, viewId: smokeViewId }),
    ).toBe(false);

    await expect(page.getByRole('button', { name: 'Smoke Hotload' })).toHaveCount(0);

    writeLensView(mindPath);

    await expect.poll(
      () => page.evaluate(async ({ mindId, viewId }) => {
        const views = await window.electronAPI.lens.getViews(mindId);
        return views.some((view) => view.id === viewId);
      }, { mindId: mind.mindId, viewId: smokeViewId }),
      { timeout: 10_000 },
    ).toBe(true);

    await expect.poll(
      () => page.evaluate((viewId) => {
        const target = window as typeof window & { __lensHotloadEvents?: string[][] };
        return target.__lensHotloadEvents?.some((ids) => ids.includes(viewId)) ?? false;
      }, smokeViewId),
    ).toBe(true);

    await expect(page.getByRole('button', { name: 'Smoke Hotload' })).toHaveCount(1);

    fs.rmSync(path.join(mindPath, '.github', 'lens', smokeViewId), { recursive: true, force: true });

    await expect.poll(
      () => page.evaluate(async ({ mindId, viewId }) => {
        const views = await window.electronAPI.lens.getViews(mindId);
        return views.some((view) => view.id === viewId);
      }, { mindId: mind.mindId, viewId: smokeViewId }),
      { timeout: 10_000 },
    ).toBe(false);

    await expect.poll(
      () => page.evaluate((viewId) => {
        const target = window as typeof window & { __lensHotloadEvents?: string[][] };
        return target.__lensHotloadEvents?.some((ids) => !ids.includes(viewId)) ?? false;
      }, smokeViewId),
    ).toBe(true);

    await expect(page.getByRole('button', { name: 'Smoke Hotload' })).toHaveCount(0);
  });

  test('applies Lens refresh results after switching away and returning', async () => {
    const page = await findRendererPage(app?.browser, app?.logs ?? []);
    await page.waitForLoadState('domcontentloaded');

    writeLensView(mindPath, {
      id: refreshViewId,
      name: 'Smoke Refresh Continuity',
      prompt: 'Refresh this deterministic smoke Lens view.',
      status: 'stale',
    });

    const mind = await page.evaluate(async ({ pathToMind }) => {
      const loaded = await window.electronAPI.mind.add(pathToMind);
      await window.electronAPI.mind.setActive(loaded.mindId);
      return loaded;
    }, { pathToMind: mindPath });

    await expect.poll(
      () => page.evaluate(async ({ mindId, viewId }) => {
        const views = await window.electronAPI.lens.getViews(mindId);
        return views.some((view) => view.id === viewId);
      }, { mindId: mind.mindId, viewId: refreshViewId }),
      { timeout: 10_000 },
    ).toBe(true);
    await page.getByRole('button', { name: /Active Lens Smoke Mind/ }).click();
    await expect(page.getByRole('button', { name: 'Smoke Refresh Continuity' })).toBeVisible();

    await page.getByRole('button', { name: 'Smoke Refresh Continuity' }).click();
    await expect(page.getByRole('heading', { name: 'Smoke Refresh Continuity' })).toBeVisible();
    await expect(page.getByText('stale', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Refreshing…', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Chat', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Smoke Refresh Continuity' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Smoke Refresh Continuity' }).click();
    await expect(page.getByRole('heading', { name: 'Smoke Refresh Continuity' })).toBeVisible();

    await expect(page.getByText('fresh', { exact: true })).toBeVisible();
    await expect(page.getByText('stale', { exact: true })).toHaveCount(0);
  });

  test('renders a Canvas Lens inside Chamber', async () => {
    const page = await findRendererPage(app?.browser, app?.logs ?? []);
    await page.waitForLoadState('domcontentloaded');

    const mind = await page.evaluate(async ({ pathToMind, pathToInactiveMind }) => {
      const loaded = await window.electronAPI.mind.add(pathToMind);
      await window.electronAPI.mind.add(pathToInactiveMind);
      await window.electronAPI.mind.setActive(loaded.mindId);
      return loaded;
    }, { pathToMind: mindPath, pathToInactiveMind: inactiveMindPath });

    writeCanvasLensView(mindPath);

    await expect.poll(
      () => page.evaluate(async ({ mindId, viewId }) => {
        const views = await window.electronAPI.lens.getViews(mindId);
        return views.some((view) => view.id === viewId && view.view === 'canvas');
      }, { mindId: mind.mindId, viewId: canvasSmokeViewId }),
      { timeout: 10_000 },
    ).toBe(true);

    await page.getByRole('button', { name: 'Canvas Smoke' }).click();

    const frame = page.frameLocator('iframe[title="Canvas Smoke"]');
    await expect(frame.getByRole('heading', { name: 'Chamber Canvas Smoke' })).toBeVisible();
    await expect(frame.getByText('Rendered through Canvas Lens')).toBeVisible();
  });

  test('routes Canvas Lens actions through the Canvas bridge', async () => {
    const page = await findRendererPage(app?.browser, app?.logs ?? []);
    await page.waitForLoadState('domcontentloaded');

    const mind = await page.evaluate(async ({ pathToMind, pathToInactiveMind }) => {
      const loaded = await window.electronAPI.mind.add(pathToMind);
      await window.electronAPI.mind.add(pathToInactiveMind);
      await window.electronAPI.mind.setActive(loaded.mindId);
      return loaded;
    }, { pathToMind: mindPath, pathToInactiveMind: inactiveMindPath });

    writeCanvasLensView(mindPath);

    await expect.poll(
      () => page.evaluate(async ({ mindId, viewId }) => {
        const views = await window.electronAPI.lens.getViews(mindId);
        return views.some((view) => view.id === viewId && view.view === 'canvas');
      }, { mindId: mind.mindId, viewId: canvasSmokeViewId }),
      { timeout: 10_000 },
    ).toBe(true);

    await page.getByRole('button', { name: 'Canvas Smoke' }).click();

    const frame = page.frameLocator('iframe[title="Canvas Smoke"]');
    await frame.getByRole('button', { name: 'Send smoke action' }).click();

    await expect(frame.getByText('Action bridge returned: ok')).toBeVisible();
    expect((app?.logs ?? []).join('\n')).not.toContain('SDK contract mismatch for tool.execution_start');
  });
});

function seedMind(root: string, name: string): void {
  fs.mkdirSync(path.join(root, '.github'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'SOUL.md'),
    [
      `# ${name}`,
      '',
      'A deterministic mind used by Electron Lens hot-load smoke tests.',
      '',
    ].join('\n'),
  );
}

function writeLensView(
  root: string,
  options: { id?: string; name?: string; prompt?: string; status?: string } = {},
): void {
  const id = options.id ?? smokeViewId;
  const viewDir = path.join(root, '.github', 'lens', id);
  fs.mkdirSync(viewDir, { recursive: true });
  fs.writeFileSync(
    path.join(viewDir, 'view.json'),
    JSON.stringify({
      name: options.name ?? 'Smoke Hotload',
      icon: 'table',
      view: 'table',
      source: 'data.json',
      ...(options.prompt ? { prompt: options.prompt } : {}),
    }, null, 2),
  );
  const data = options.status ? { status: options.status } : { rows: [{ status: 'ok' }] };
  fs.writeFileSync(path.join(viewDir, 'data.json'), JSON.stringify(data, null, 2));
}

function writeCanvasLensView(root: string): void {
  const viewDir = path.join(root, '.github', 'lens', canvasSmokeViewId);
  fs.mkdirSync(viewDir, { recursive: true });
  fs.writeFileSync(
    path.join(viewDir, 'view.json'),
    JSON.stringify({
      name: 'Canvas Smoke',
      icon: 'layout',
      view: 'canvas',
      source: 'index.html',
    }, null, 2),
  );
  fs.writeFileSync(
    path.join(viewDir, 'index.html'),
    [
      '<!DOCTYPE html>',
      '<html lang="en">',
      '<head><meta charset="utf-8"><title>Canvas Smoke</title></head>',
      '<body>',
      '  <main class="ch-page">',
      '    <section class="ch-card">',
      '      <p class="ch-badge">Rendered through Canvas Lens</p>',
      '      <h1>Chamber Canvas Smoke</h1>',
      '      <button class="ch-button" type="button" onclick="sendSmokeAction()">Send smoke action</button>',
      '      <p id="action-result" class="ch-muted">Action pending</p>',
      '    </section>',
      '  </main>',
      '  <script>',
      '    async function sendSmokeAction() {',
      '      const response = await window.canvas.sendAction("smoke-test-click", { ok: true });',
      '      const result = await response.json();',
      '      document.getElementById("action-result").textContent = result.ok ? "Action bridge returned: ok" : "Action bridge failed";',
      '    }',
      '  </script>',
      '</body>',
      '</html>',
    ].join('\n'),
    'utf8',
  );
}

async function removeTempRoot(root: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM' || attempt === 9) {
        console.warn(`[lens-smoke] Failed to remove temp root ${root}:`, error);
        return;
      }
      await delay(250);
    }
  }
}
