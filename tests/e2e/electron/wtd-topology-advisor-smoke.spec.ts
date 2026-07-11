// Both layers use a live Copilot agent. The fake WTD runtime keeps the default
// smoke deterministic; the separately gated real-model smoke verifies v0.4.3.

import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import { findRendererPage, launchElectronApp, type LaunchedElectronApp } from './electronApp';

const liveWtdEnabled = process.env.CHAMBER_E2E_LIVE_WTD === '1';
const realModelEnabled =
  liveWtdEnabled && process.env.CHAMBER_E2E_LIVE_WTD_REAL_MODEL === '1';

const FAKE_CDP_PORT = Number(process.env.CHAMBER_E2E_WTD_CDP_PORT ?? 9364);
const REAL_CDP_PORT = Number(process.env.CHAMBER_E2E_WTD_REAL_MODEL_CDP_PORT ?? 9365);

const WTD_PERSONA_NAME = 'Wendeline Topo';
const CHAT_PLACEHOLDER = 'Message your agent\u2026 (paste an image to attach)';

interface ToolStartEntry {
  toolName: string;
}

interface ToolDoneEntry {
  toolName: string;
  success: boolean;
  result: string | undefined;
}

interface WtdChatResult {
  starts: ToolStartEntry[];
  dones: ToolDoneEntry[];
  assistantText: string;
  errorMessage: string;
}

interface WtdToolPayload {
  revision: string;
  cacheHit: boolean;
  queryKind: string;
  querySummary: string;
  candidates: Array<{ id?: string; name: string; score: number }>;
}

test.describe('electron WTD topology advisor smoke — fake runtime (live SDK)', () => {
  test.skip(
    !liveWtdEnabled,
    'Set CHAMBER_E2E_LIVE_WTD=1 to run the WTD fake-runtime smoke.',
  );
  test.setTimeout(360_000);

  let app: LaunchedElectronApp | undefined;
  let root = '';
  let userDataPath = '';

  test.afterEach(async () => {
    await app?.close();
    app = undefined;
    if (root) await removeTempRoot(root);
  });

  test(
    'agent calls wtd_retrieve_topology then authors, validates, and runs a ttasks automation (#400)',
    async () => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-wtd-fake-smoke-'));
      userDataPath = path.join(root, 'user-data');
      const mindPath = path.join(root, 'wendeline-topo');
      seedMind(mindPath, WTD_PERSONA_NAME);

      app = await launchElectronApp({
        cdpPort: FAKE_CDP_PORT,
        env: {
          CHAMBER_E2E_USER_DATA: userDataPath,
          // Routes main.ts WtdAdvisorService construction to FakeWtdRuntimeClient.
          // No ONNX binary is loaded; the handler returns a deterministic topology
          // response so the Copilot model receives stable guidance to author against.
          CHAMBER_E2E_WTD_FAKE_TOPOLOGY: '1',
        },
      });

      const page = await findRendererPage(app.browser, app.logs);
      await waitForMindApi(page);
      const mind = await loadAndActivateMind(page, mindPath, WTD_PERSONA_NAME);

      const jobToken = randomUUID().slice(0, 8);
      const scriptRelPath = `.chamber/automation/wtd-smoke-${jobToken}.ts`;
      const messageId = `wtd-smoke-${jobToken}`;
      const chatMessage = buildChatMessage(scriptRelPath);

      const result = await driveChatTurn(page, mind.mindId, messageId, chatMessage);

      assertBaseToolFlow(result, scriptRelPath, mindPath);
      await assertRendererHealth(page);
    },
  );
});

test.describe('electron WTD topology advisor smoke — real v0.4.3 model (opt-in)', () => {
  test.skip(
    !realModelEnabled,
    'Set CHAMBER_E2E_LIVE_WTD=1 and CHAMBER_E2E_LIVE_WTD_REAL_MODEL=1 to run the real WTD model smoke.',
  );
  // Budget for cold HF download + ONNX warm-up + SDK agent turn.
  // Warm runs with a pre-seeded CHAMBER_E2E_WTD_MODEL_CACHE_DIR typically
  // complete in 3–4 minutes; allow up to 10 on first cold download.
  test.setTimeout(600_000);

  let app: LaunchedElectronApp | undefined;
  let root = '';
  let userDataPath = '';

  test.afterEach(async () => {
    await app?.close();
    app = undefined;
    if (root) await removeTempRoot(root);
  });

  test(
    'agent calls wtd_retrieve_topology with real v0.4.3 model then authors, validates, and runs a ttasks automation (#400)',
    async () => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-wtd-real-smoke-'));
      userDataPath = path.join(root, 'user-data');
      const mindPath = path.join(root, 'wendeline-topo');
      seedMind(mindPath, WTD_PERSONA_NAME);

      // Point to a pre-seeded cache to avoid re-downloading the v0.4.3 bundle
      // on every run.  Omit the env var to let ChamberWtdRuntimeClient write
      // to a per-run temp dir and download from HF automatically (slow, but
      // correct on a cold machine or first-run CI validation job).
      const modelCacheDir =
        process.env.CHAMBER_E2E_WTD_MODEL_CACHE_DIR ??
        path.join(root, 'wtd-model-cache');

      app = await launchElectronApp({
        cdpPort: REAL_CDP_PORT,
        env: {
          CHAMBER_E2E_USER_DATA: userDataPath,
          // CHAMBER_E2E_WTD_FAKE_TOPOLOGY intentionally absent:
          // main.ts constructs ChamberWtdRuntimeClient with the real ONNX model.
          CHAMBER_E2E_WTD_MODEL_CACHE_DIR: modelCacheDir,
        },
      });

      const page = await findRendererPage(app.browser, app.logs);
      await waitForMindApi(page);
      const mind = await loadAndActivateMind(page, mindPath, WTD_PERSONA_NAME);

      const jobToken = randomUUID().slice(0, 8);
      const scriptRelPath = `.chamber/automation/wtd-smoke-real-${jobToken}.ts`;
      const messageId = `wtd-smoke-real-${jobToken}`;
      const chatMessage = buildChatMessage(scriptRelPath);

      const result = await driveChatTurn(page, mind.mindId, messageId, chatMessage);

      assertBaseToolFlow(result, scriptRelPath, mindPath);
      await assertRendererHealth(page);

      const wtdDone = result.dones.find((d) => d.toolName === 'wtd_retrieve_topology');
      expect(
        wtdDone?.result,
        'wtd_retrieve_topology tool_done must carry a JSON result payload',
      ).toBeTruthy();

      const wtdPayload = JSON.parse(wtdDone!.result!) as WtdToolPayload;

      // M — pinned revision from the committed chamber-wtd-runtime bundle.
      //     Fails loudly if ChamberWtdRuntimeClient loads the wrong bundle.
      expect(
        wtdPayload.revision,
        'WTD revision must match the pinned v0.4.3 bundle',
      ).toBe('v0.4.3');

      // N — real retrieval returned at least one topology candidate.
      expect(
        wtdPayload.candidates.length,
        'real WTD model must return at least one candidate',
      ).toBeGreaterThanOrEqual(1);

      const topScore = wtdPayload.candidates[0].score;
      expect(Number.isFinite(topScore), 'candidate score must be finite').toBe(true);
      expect(topScore, 'candidate score must be > 0').toBeGreaterThan(0);

      // P — cacheHit is a proper boolean (not null / undefined).
      //     True on warm runs with a pre-seeded CHAMBER_E2E_WTD_MODEL_CACHE_DIR;
      //     false on a cold first download — either is acceptable here.
      expect(
        typeof wtdPayload.cacheHit,
        'cacheHit must be a boolean',
      ).toBe('boolean');
    },
  );
});

function buildChatMessage(scriptRelPath: string): string {
  return [
    'Create a minimal WTD topology smoke automation.',
    'STEP 1: Call wtd_retrieve_topology with query "create greeting workflow".',
    'STEP 2: Use the first candidate returned.',
    `STEP 3: Author a standalone @ianphil/ttasks-ts script at path "${scriptRelPath}".`,
    'Include one task "hello" that prints a greeting',
    'and one task "goodbye" that depends on "hello".',
    `STEP 4: Call automation_validate on "${scriptRelPath}".`,
    `STEP 5: Call automation_run on "${scriptRelPath}".`,
    'STEP 6: Reply with exactly: WTD_SMOKE_DONE',
  ].join(' ');
}

async function driveChatTurn(
  page: Page,
  mindId: string,
  messageId: string,
  text: string,
): Promise<WtdChatResult> {
  return page.evaluate(
    async ({ mId, msgId, msg }) => {
      const idToName = new Map<string, string>();
      const starts: Array<{ toolName: string }> = [];
      const dones: Array<{ toolName: string; success: boolean; result: string | undefined }> = [];
      let assistantText = '';
      let errorMessage = '';

      let resolveTerminal: () => void = () => undefined;
      const terminal = new Promise<void>((resolve) => {
        resolveTerminal = resolve;
      });

      const unsub = window.electronAPI.chat.onEvent((rxMindId, rxMsgId, event) => {
        if (rxMindId !== mId || rxMsgId !== msgId) return;

        if (event.type === 'tool_start') {
          idToName.set(event.toolCallId, event.toolName);
          starts.push({ toolName: event.toolName });
        }

        if (event.type === 'tool_done') {
          dones.push({
            toolName: idToName.get(event.toolCallId) ?? 'unknown',
            success: event.success,
            result: event.result,
          });
        }

        if (event.type === 'chunk') {
          assistantText += event.content;
        }

        if (event.type === 'message_final') {
          assistantText += event.content;
        }

        if (event.type === 'error') {
          errorMessage = event.message;
          resolveTerminal();
        }

        if (event.type === 'done' || event.type === 'timeout') {
          resolveTerminal();
        }
      });

      try {
        const sendPromise = window.electronAPI.chat.send(mId, msg, msgId);
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(
            () => reject(new Error('driveChatTurn: timed out waiting for terminal event')),
            300_000,
          );
        });
        await Promise.race([
          Promise.all([sendPromise, terminal]),
          timeoutPromise,
        ]);
        return { starts, dones, assistantText, errorMessage };
      } finally {
        unsub();
      }
    },
    { mId: mindId, msgId: messageId, msg: text },
  );
}

function assertBaseToolFlow(
  result: WtdChatResult,
  scriptRelPath: string,
  mindPath: string,
): void {
  expect(result.errorMessage).toBe('');

  const startNames = result.starts.map((s) => s.toolName);
  expect(startNames, 'wtd_retrieve_topology was not called').toContain('wtd_retrieve_topology');
  expect(startNames, 'automation_validate was not called').toContain('automation_validate');
  expect(startNames, 'automation_run was not called').toContain('automation_run');

  const wtdIdx = startNames.indexOf('wtd_retrieve_topology');
  const validateIdx = startNames.indexOf('automation_validate');
  expect(
    wtdIdx,
    'wtd_retrieve_topology must be called before automation_validate',
  ).toBeLessThan(validateIdx);

  const wtdDone = result.dones.find((d) => d.toolName === 'wtd_retrieve_topology');
  expect(wtdDone, 'no tool_done event received for wtd_retrieve_topology').toBeDefined();
  expect(wtdDone?.success, 'wtd_retrieve_topology reported a failure').toBe(true);

  const validateDone = result.dones.find((d) => d.toolName === 'automation_validate');
  expect(validateDone, 'no tool_done event received for automation_validate').toBeDefined();
  expect(validateDone?.success, 'automation_validate reported a failure').toBe(true);

  const runDone = result.dones.find((d) => d.toolName === 'automation_run');
  expect(runDone, 'no tool_done event received for automation_run').toBeDefined();
  expect(runDone?.success, 'automation_run reported a failure').toBe(true);

  expect(result.assistantText, 'agent did not emit WTD_SMOKE_DONE').toContain('WTD_SMOKE_DONE');

  const absoluteScript = path.resolve(mindPath, scriptRelPath);
  expect(
    fs.existsSync(absoluteScript),
    `automation script not found at ${absoluteScript}`,
  ).toBe(true);

  const source = fs.readFileSync(absoluteScript, 'utf8');

  expect(source, 'script must import @ianphil/ttasks-ts').toMatch(/@ianphil\/ttasks-ts/);
  expect(source, 'script must construct new TaskGraph').toMatch(/new\s+TaskGraph/);
  expect(source, 'script must not call runGraph()').not.toMatch(/\brunGraph\s*\(/);
}

async function assertRendererHealth(page: Page): Promise<void> {
  const textarea = page.getByPlaceholder(CHAT_PLACEHOLDER);
  await expect(textarea).toBeEnabled({ timeout: 60_000 });
  await expect(page.getByText(/Agent timed out after/i)).toHaveCount(0);
  await expect(page.getByText(/^Error:/)).toHaveCount(0);
}

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

function seedMind(mindRoot: string, name: string): void {
  fs.mkdirSync(path.join(mindRoot, '.github', 'agents'), { recursive: true });

  fs.writeFileSync(
    path.join(mindRoot, 'SOUL.md'),
    [
      `# ${name}`,
      '',
      'You author @ianphil/ttasks-ts automation DAGs.',
      'MANDATORY workflow — follow every numbered step in order, without skipping:',
      '',
      '1. Call wtd_retrieve_topology with your workflow intent as the query.',
      '2. Read the guidance field of the first candidate returned.',
      '3. Author a standalone TypeScript script at the exact path specified.',
      '   Requirements: import from @ianphil/ttasks-ts, construct new TaskGraph,',
      '   do NOT call runGraph().',
      '4. Call automation_validate on that script path.',
      '5. Call automation_run on that script path.',
      '6. Reply with the exact confirmation string the user specifies.',
      '',
      'Never skip step 1. Always call wtd_retrieve_topology before authoring.',
      '',
    ].join('\n'),
  );

  fs.writeFileSync(
    path.join(mindRoot, '.github', 'agents', 'wendeline-topo.agent.md'),
    [
      '---',
      `name: ${name}`,
      'description: WTD topology advisor smoke-test persona',
      '---',
      '',
      `# ${name}`,
      '',
      'Follow the mandatory 6-step automation authoring workflow.',
      'Use the first topology candidate returned by wtd_retrieve_topology.',
      'Author all scripts as standalone @ianphil/ttasks-ts TaskGraph programs.',
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
        console.warn(`[wtd-smoke] Failed to remove temp root ${root}:`, error);
        return;
      }
      await delay(250);
    }
  }
}
