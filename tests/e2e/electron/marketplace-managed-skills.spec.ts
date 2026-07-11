import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { findRendererPage, launchElectronApp, type LaunchedElectronApp } from './electronApp';

const cdpPort = Number(process.env.CHAMBER_E2E_MARKETPLACE_SKILLS_CDP_PORT ?? 9352);
const marketplaceId = 'github:ianphil/genesis-minds';
const coreSkillIds = ['automation', 'lens', 'ttasks'];

test.describe('electron marketplace managed skills smoke', () => {
  test.setTimeout(240_000);

  let app: LaunchedElectronApp | undefined;
  let mindPath = '';
  let userDataPath = '';
  const tempRoots: string[] = [];

  test.beforeAll(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-marketplace-managed-skills-smoke-'));
    mindPath = path.join(root, 'marketplace-mind');
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

  test('installs core Chamber skills from the default marketplace into a fresh mind', async () => {
    const page = await findRendererPage(app?.browser, app?.logs ?? []);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#root')).not.toBeEmpty();
    await expect(page.getByRole('button', { name: /Open Existing/i })).toBeVisible();

    const mind = await page.evaluate(async (pathToMind) => {
      const mind = await window.electronAPI.mind.add(pathToMind);
      await window.electronAPI.mind.setActive(mind.mindId);
      return mind;
    }, mindPath);

    expect(mind.identity.name).toBe('Marketplace Mind');

    await expect.poll(() => {
      const summary = readInstalledSkillSummary(mindPath);
      return coreSkillIds.every((skillId) => summary[skillId] !== null);
    }, {
      timeout: 90_000,
      intervals: [500, 1_000, 2_000],
      message: 'Expected marketplace managed skills to install into the fresh mind.',
    }).toBe(true);

    const installedSkills = readInstalledSkillSummary(mindPath);
    for (const skillId of coreSkillIds) {
      const installedSkill = installedSkills[skillId];
      expect(installedSkill).not.toBeNull();
      expect(installedSkill?.marketplaceId).toBe(marketplaceId);
      expect(installedSkill?.version).not.toBe('');
      expect(installedSkill?.fileCount).toBeGreaterThan(0);
    }

    await page.evaluate((mindId) => window.electronAPI.mind.remove(mindId), mind.mindId);
  });
});

function seedMind(targetMindPath: string): void {
  fs.mkdirSync(path.join(targetMindPath, '.github', 'agents'), { recursive: true });
  fs.mkdirSync(path.join(targetMindPath, '.working-memory'), { recursive: true });
  fs.writeFileSync(
    path.join(targetMindPath, 'SOUL.md'),
    [
      '# Marketplace Mind',
      '',
      'You are a Chamber smoke-test mind used to verify marketplace managed skill installation.',
      '',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(targetMindPath, '.github', 'agents', 'marketplace-mind.agent.md'),
    [
      '---',
      'name: Marketplace Mind',
      'description: Chamber marketplace managed skill smoke-test persona',
      '---',
      '',
      '# Marketplace Mind Agent',
      '',
      'Help verify Chamber marketplace managed skills.',
      '',
    ].join('\n'),
  );
  for (const file of ['memory.md', 'rules.md', 'log.md']) {
    fs.writeFileSync(path.join(targetMindPath, '.working-memory', file), '');
  }
}

interface SkillMetadata {
  version?: string;
  files?: unknown[];
  source?: {
    marketplaceId?: string;
  };
}

function readInstalledSkillSummary(targetMindPath: string): Record<string, { version: string; fileCount: number; marketplaceId: string } | null> {
  return Object.fromEntries(coreSkillIds.map((skillId) => {
    const metadataPath = path.join(targetMindPath, '.github', 'skills', skillId, '.chamber-skill.json');
    if (!fs.existsSync(metadataPath)) return [skillId, null];
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as SkillMetadata;
    return [skillId, {
      version: metadata.version ?? '',
      fileCount: metadata.files?.length ?? 0,
      marketplaceId: metadata.source?.marketplaceId ?? '',
    }];
  }));
}

async function removeTempRoot(root: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM' || attempt === 9) {
        console.warn(`[marketplace-managed-skills-smoke] Failed to remove temp root ${root}:`, error);
        return;
      }
      await delay(250);
    }
  }
}
