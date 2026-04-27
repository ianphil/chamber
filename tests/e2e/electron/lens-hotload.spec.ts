import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { findRendererPage, launchElectronApp, type LaunchedElectronApp } from './electronApp';

const cdpPort = Number(process.env.CHAMBER_E2E_LENS_CDP_PORT ?? 9336);
const smokeViewId = 'smoke-hotload';

test.describe('electron Lens hot-load smoke', () => {
  test.setTimeout(180_000);

  let app: LaunchedElectronApp | undefined;
  let mindPath = '';
  let userDataPath = '';
  const tempRoots: string[] = [];

  test.beforeAll(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-lens-smoke-'));
    mindPath = path.join(root, 'lens-smoke-mind');
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

  test('hot-loads created and deleted Lens views without restarting Electron', async () => {
    const page = await findRendererPage(app?.browser, app?.logs ?? []);
    await page.waitForLoadState('domcontentloaded');

    const mind = await page.evaluate(async (pathToMind) => {
      const loaded = await window.electronAPI.mind.add(pathToMind);
      await window.electronAPI.mind.setActive(loaded.mindId);
      return loaded;
    }, mindPath);

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
  });
});

function seedMind(root: string): void {
  fs.mkdirSync(path.join(root, '.github'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'SOUL.md'),
    [
      '# Lens Smoke Mind',
      '',
      'A deterministic mind used by Electron Lens hot-load smoke tests.',
      '',
    ].join('\n'),
  );
}

function writeLensView(root: string): void {
  const viewDir = path.join(root, '.github', 'lens', smokeViewId);
  fs.mkdirSync(viewDir, { recursive: true });
  fs.writeFileSync(
    path.join(viewDir, 'view.json'),
    JSON.stringify({
      name: 'Smoke Hotload',
      icon: 'table',
      view: 'table',
      source: 'data.json',
    }, null, 2),
  );
  fs.writeFileSync(path.join(viewDir, 'data.json'), JSON.stringify({ rows: [{ status: 'ok' }] }, null, 2));
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
