import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { findRendererPage, launchElectronApp, type LaunchedElectronApp } from './electronApp';

const cdpPort = Number(process.env.CHAMBER_E2E_CRON_CDP_PORT ?? 9340);
const expectedReply = 'CRON_SMOKE_OK';
const cronInstruction = [
  'When asked to run the cron lifecycle smoke, use Chamber cron tools to:',
  '1. create a disabled notification cron job with the exact requested name, schedule, title, and body;',
  '2. list cron jobs and confirm the job exists;',
  '3. run the job immediately;',
  '4. inspect cron history for the job;',
  '5. remove the job;',
  `6. verify it is gone, then answer exactly ${expectedReply} and no other text.`,
].join(' ');

test.describe('electron Monica cron tools smoke', () => {
  test.setTimeout(240_000);

  let app: LaunchedElectronApp | undefined;
  let mindPath = '';
  let userDataPath = '';
  const tempRoots: string[] = [];

  test.beforeAll(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-cron-tools-smoke-'));
    mindPath = path.join(root, 'monica');
    userDataPath = path.join(root, 'user-data');
    tempRoots.push(root);
    seedMonicaMind(mindPath);

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

  test('creates, runs, lists, histories, and removes a cron notification job through chat tools', async () => {
    const page = await findRendererPage(app?.browser, app?.logs ?? []);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#root')).not.toBeEmpty();

    const mind = await page.evaluate(async (pathToMind) => {
      const mind = await window.electronAPI.mind.add(pathToMind);
      await window.electronAPI.mind.setActive(mind.mindId);
      return mind;
    }, mindPath);

    await expect.poll(
      () => page.evaluate(() => window.electronAPI.mind.list().then((minds) => minds.map((item) => item.identity.name))),
    ).toEqual(['Monica']);

    await page.getByRole('button', { name: 'Monica' }).first().click();
    await expect(page.getByText('How can I help you today?')).toBeVisible();

    const uniqueSuffix = Date.now();
    const jobName = `Cron Smoke ${uniqueSuffix}`;
    const result = await page.evaluate(async ({ expected, mindId, name }) => {
      const messageId = `cron-smoke-${Date.now()}`;
      const events: Array<{ type: string; content?: string; message?: string; toolName?: string; success?: boolean; error?: string }> = [];
      let assistantText = '';
      let errorMessage = '';
      let resolveTerminal: () => void = () => undefined;
      const terminal = new Promise<void>((resolve) => {
        resolveTerminal = resolve;
      });
      const unsubscribe = window.electronAPI.chat.onEvent((receivedMindId, receivedMessageId, event) => {
        if (receivedMindId !== mindId || receivedMessageId !== messageId) return;
        events.push(event);
        if (event.type === 'chunk' || event.type === 'message_final') {
          assistantText += event.content;
        }
        if (event.type === 'error') {
          errorMessage = event.message;
          resolveTerminal();
        }
        if (event.type === 'done') {
          resolveTerminal();
        }
      });

      try {
        const send = window.electronAPI.chat.send(
          mindId,
          [
            'Run the cron lifecycle smoke now using your cron tools.',
            `Create a disabled notification job named "${name}" with schedule "0 9 * * *".`,
            `The cron_create call must include payload: {"title":"${name}","body":"Cron scheduler smoke test fired."}.`,
            'List jobs to confirm it exists, run it now, inspect its history, remove it, and list again to verify it is gone.',
            `After verifying removal, reply exactly ${expected} and no other text.`,
          ].join(' '),
          messageId,
        );
        const timeout = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Timed out waiting for cron smoke response.')), 240_000);
        });
        await Promise.race([Promise.all([send, terminal]), timeout]);
        return { assistantText, errorMessage, events };
      } finally {
        unsubscribe();
      }
    }, { expected: expectedReply, mindId: mind.mindId, name: jobName });

    expect(result.errorMessage).toBe('');
    expect(result.assistantText).toContain(expectedReply);
    expect(result.events.filter((event) => event.type === 'tool_done' && event.success === false)).toEqual([]);
    expect(result.events.filter((event) => event.type === 'tool_start').map((event) => event.toolName)).toEqual(
      expect.arrayContaining(['cron_create', 'cron_list', 'cron_run_now', 'cron_history', 'cron_remove']),
    );

    const jobs = readCronJobs(mindPath);
    expect(jobs.some((job) => job.name === jobName)).toBe(false);
  });
});

function seedMonicaMind(targetMindPath: string): void {
  fs.mkdirSync(path.join(targetMindPath, '.github', 'agents'), { recursive: true });
  fs.mkdirSync(path.join(targetMindPath, '.working-memory'), { recursive: true });
  fs.writeFileSync(
    path.join(targetMindPath, 'SOUL.md'),
    [
      '# Monica',
      '',
      'You are Monica, Chamber\'s meticulous, upbeat, systems-minded organizer.',
      cronInstruction,
      '',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(targetMindPath, '.github', 'agents', 'monica.agent.md'),
    [
      '---',
      'name: Monica',
      'description: Chamber cron smoke-test organizer persona',
      '---',
      '',
      '# Monica Agent',
      '',
      'Use Chamber tools carefully and finish deterministic smoke tests with the requested exact token.',
      '',
    ].join('\n'),
  );
  for (const file of ['memory.md', 'rules.md', 'log.md']) {
    fs.writeFileSync(
      path.join(targetMindPath, '.working-memory', file),
      file === 'memory.md' ? `${cronInstruction}\n` : '',
    );
  }
}

function readCronJobs(targetMindPath: string): Array<{ name?: string }> {
  const jobsPath = path.join(targetMindPath, '.chamber', 'cron.json');
  if (!fs.existsSync(jobsPath)) return [];
  const parsed = JSON.parse(fs.readFileSync(jobsPath, 'utf-8')) as { jobs?: Array<{ name?: string }> };
  return parsed.jobs ?? [];
}

async function removeTempRoot(root: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM' || attempt === 9) {
        console.warn(`[cron-tools-smoke] Failed to remove temp root ${root}:`, error);
        return;
      }
      await delay(250);
    }
  }
}
