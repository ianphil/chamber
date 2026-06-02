import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import { findRendererPage, launchElectronApp, type LaunchedElectronApp } from './electronApp';

// True end-to-end smoke for the cron/automation surface. No mocks, no fakes,
// no pre-seeded script, no IPC shortcuts. We launch the app, type a request
// into the chat box exactly like a user would, press send, and let the REAL
// Copilot agent do the work: read the bootstrapped `automation` + `ttasks`
// skills, author a standalone ttasks app under `.chamber/automation/`,
// validate it, and schedule it as a cron job.
//
// Then we verify the agent actually did what we asked by inspecting the
// durable artifacts on disk:
//   1. `.chamber/schedules/cron.json` contains a job with the name we asked
//      for, the schedule we asked for, created disabled.
//   2. The job's scriptPath points at a real `.ts` file under
//      `.chamber/automation/`.
//   3. That script is a standalone ttasks app — it imports from
//      `@ianphil/ttasks-ts` and builds a `TaskGraph` — and does NOT lean on
//      the removed `runGraph` helper.
const cdpPort = Number(process.env.CHAMBER_E2E_CRON_CDP_PORT ?? 9363);

interface StoredCronJob {
  id: string;
  name: string;
  schedule: string;
  scriptPath: string;
  enabled: boolean;
}

test.describe('electron cron automation create smoke', () => {
  test.setTimeout(300_000);

  let app: LaunchedElectronApp | undefined;
  let root = '';
  let userDataPath = '';

  test.afterEach(async () => {
    await app?.close();
    app = undefined;
    if (root) await removeTempRoot(root);
  });

  test('agent authors a standalone ttasks app and schedules it as a cron job from a chat request', async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-cron-create-smoke-'));
    userDataPath = path.join(root, 'user-data');
    const mindPath = path.join(root, 'heinz-doofenshmirtz');
    seedMind(mindPath, 'Heinz Doofenshmirtz');

    // Unique, easy-to-assert job name so we can find exactly the job the
    // agent created and nothing else.
    const jobToken = randomUUID().slice(0, 8);
    const jobName = `smoke-greeting-${jobToken}`;
    const schedule = '0 9 * * *';

    app = await launchElectronApp({
      cdpPort,
      env: { CHAMBER_E2E_USER_DATA: userDataPath },
    });
    const page = await findRendererPage(app.browser, app.logs);
    await waitForMindApi(page);
    await loadAndActivateMind(page, mindPath, 'Heinz Doofenshmirtz');

    // Real interaction: click into the textarea, type a genuine request,
    // press Enter. We do NOT tell the agent how to write the code — the
    // bootstrapped skills do. We only fix the observable contract (job
    // name + schedule) so we can assert on it afterwards.
    const textarea = page.getByPlaceholder('Message your agent… (paste an image to attach)');
    await expect(textarea).toBeEnabled();
    await textarea.click();
    await textarea.fill(
      `Create a scheduled automation for me. Author a standalone ttasks ` +
      `automation saved under .chamber/automation/ that runs a single bash ` +
      `task printing a friendly greeting. Validate the automation, then ` +
      `schedule it as a cron job named exactly "${jobName}" on the schedule ` +
      `"${schedule}". Create the cron job disabled so it does not run right ` +
      `now. When the cron job has been created, reply with DONE.`,
    );
    await textarea.press('Enter');

    // The durable signal that the agent did what we asked: a cron job with
    // our name lands in cron.json AND the script it points at exists on
    // disk. cron_create runs last in the documented workflow (author →
    // validate → create), so folding the script-file check into the poll
    // closes the window where the job row is flushed before the file is.
    // Poll generously — this is a real, multi-tool model turn.
    const cronJobsPath = path.join(mindPath, '.chamber', 'schedules', 'cron.json');
    await expect
      .poll(
        () => {
          const found = readCronJobs(cronJobsPath).find((job) => job.name === jobName);
          if (!found) return false;
          return fs.existsSync(path.resolve(mindPath, found.scriptPath));
        },
        { timeout: 240_000, intervals: [2_000] },
      )
      .toBe(true);

    // Let the chat turn finish cleanly before asserting on rendered errors —
    // the textarea re-enables once streaming ends.
    await expect(textarea).toBeEnabled({ timeout: 60_000 });
    await expect(page.getByText(/Agent timed out after/i)).toHaveCount(0);
    await expect(page.getByText(/^Error:/)).toHaveCount(0);

    const job = readCronJobs(cronJobsPath).find((entry) => entry.name === jobName);
    expect(job, `cron job "${jobName}" should exist in cron.json`).toBeDefined();
    expect(job!.schedule).toBe(schedule);
    expect(job!.enabled).toBe(false);

    // The scheduled script must be a real, mind-relative `.ts` file contained
    // under `.chamber/automation/` (no traversal, no absolute path).
    expect(path.isAbsolute(job!.scriptPath)).toBe(false);
    const automationRoot = path.join(mindPath, '.chamber', 'automation');
    const absoluteScriptPath = path.resolve(mindPath, job!.scriptPath);
    const relativeToAutomation = path.relative(automationRoot, absoluteScriptPath);
    expect(relativeToAutomation.startsWith('..')).toBe(false);
    expect(relativeToAutomation).not.toBe('');
    expect(absoluteScriptPath.endsWith('.ts')).toBe(true);
    expect(fs.existsSync(absoluteScriptPath), `${absoluteScriptPath} should exist`).toBe(true);

    // The authored script is a standalone ttasks app: it pulls in the ttasks
    // runtime and builds a TaskGraph itself rather than delegating to a
    // removed wrapper.
    const scriptSource = fs.readFileSync(absoluteScriptPath, 'utf8');
    expect(scriptSource).toMatch(/@ianphil\/ttasks-ts/);
    expect(scriptSource).toMatch(/new\s+TaskGraph/);
    expect(scriptSource).not.toMatch(/\brunGraph\s*\(/);
  });
});

async function waitForMindApi(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#root')).not.toBeEmpty();
  await expect.poll(async () => {
    try {
      return await page.evaluate(() => typeof window.electronAPI?.mind?.add);
    } catch {
      return 'unavailable';
    }
  }, { timeout: 30_000 }).toBe('function');
}

async function loadAndActivateMind(page: Page, mindPath: string, name: string) {
  const mind = await page.evaluate(async (pathToMind) => {
    const loaded = await window.electronAPI.mind.add(pathToMind);
    await window.electronAPI.mind.setActive(loaded.mindId);
    return loaded;
  }, mindPath);
  const mindButton = page.getByRole('button', { name }).first();
  await mindButton.click();
  await expect(mindButton).toHaveClass(/bg-accent/);
  return mind;
}

function readCronJobs(cronJobsPath: string): StoredCronJob[] {
  try {
    const raw = fs.readFileSync(cronJobsPath, 'utf8');
    const parsed = JSON.parse(raw) as { jobs?: StoredCronJob[] };
    return Array.isArray(parsed.jobs) ? parsed.jobs : [];
  } catch {
    return [];
  }
}

function seedMind(root: string, name: string): void {
  fs.mkdirSync(path.join(root, '.github', 'agents'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'SOUL.md'),
    [
      `# ${name}`,
      '',
      'A mind used by the cron automation create smoke test. When asked to',
      'create a scheduled automation, use the bundled automation and ttasks',
      'skills to author a standalone ttasks app, validate it, then schedule',
      'it with cron.',
      '',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(root, '.github', 'agents', 'heinz-doofenshmirtz.agent.md'),
    [
      '---',
      `name: ${name}`,
      'description: Cron automation create smoke-test persona',
      '---',
      '',
      `# ${name}`,
      '',
      'You build small scheduled automations on request. Always author them as',
      'standalone ttasks apps saved under .chamber/automation/, validate them,',
      'and schedule them with cron exactly as asked.',
      '',
    ].join('\n'),
  );
}

async function removeTempRoot(root: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM' || attempt === 9) {
        console.warn(`[cron-create-smoke] Failed to remove temp root ${root}:`, error);
        return;
      }
      await delay(250);
    }
  }
}
