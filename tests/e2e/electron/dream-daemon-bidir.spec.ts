import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { findRendererPage, launchElectronApp, type LaunchedElectronApp } from './electronApp';

// v0.60.0 dream-daemon opt-in UX + bidirectional migration validation.
//
// One spec, four flows. Mirrors the spec in the validation request:
//   Flow 1 — Genesis OFF (default Switch left untouched)
//   Flow 2 — Genesis ON  (Switch toggled before "That's my purpose")
//   Flow 3 — Post-genesis OFF→ON via profile modal
//   Flow 4 — Post-genesis ON→OFF via profile modal (rollback path)
//
// Real Copilot SDK is required for Genesis (SOUL.md generation) and chat
// turns. Skipped unless CHAMBER_E2E_LIVE_GENESIS=1, exactly like the
// existing genesis-ernest-chat smoke. CHAMBER_LOG_LEVEL=debug is set so
// MindMemoryService activate/release no-op debug lines are visible.

const cdpPort = Number(process.env.CHAMBER_E2E_DREAM_DAEMON_CDP_PORT ?? 9351);
const liveGenesisEnabled = process.env.CHAMBER_E2E_LIVE_GENESIS === '1';

const offMindName = 'OffMind';
const onMindName = 'OnMind';
const offSlug = 'offmind';
const onSlug = 'onmind';

interface FlowEvidence {
  flow: string;
  passed: boolean;
  failures: string[];
  notes: string[];
}

test.describe('electron dream-daemon bidirectional toggle smoke', () => {
  test.skip(!liveGenesisEnabled, 'Set CHAMBER_E2E_LIVE_GENESIS=1 to run the live dream-daemon smoke.');
  test.setTimeout(45 * 60_000);

  let app: LaunchedElectronApp | undefined;
  let userDataPath = '';
  let genesisBasePath = '';
  let offMindPath = '';
  let onMindPath = '';
  const tempRoots: string[] = [];

  test.beforeAll(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-dream-daemon-bidir-'));
    userDataPath = path.join(root, 'user-data');
    genesisBasePath = path.join(root, 'agents');
    offMindPath = path.join(genesisBasePath, offSlug);
    onMindPath = path.join(genesisBasePath, onSlug);
    tempRoots.push(root);

    app = await launchElectronApp({
      cdpPort,
      env: {
        CHAMBER_E2E_USER_DATA: userDataPath,
        CHAMBER_E2E_GENESIS_BASE_PATH: genesisBasePath,
        CHAMBER_LOG_LEVEL: 'debug',
      },
    });
  });

  test.afterAll(async () => {
    await app?.close();
    for (const root of tempRoots) {
      await removeTempRoot(root);
    }
  });

  test('OFF/ON Switch on Genesis + post-genesis bidirectional toggle with rollback', async () => {
    const page = await findRendererPage(app?.browser, app?.logs ?? []);
    await page.waitForLoadState('domcontentloaded');

    const consoleMessages: Array<{ type: string; text: string }> = [];
    page.on('console', (message) => {
      consoleMessages.push({ type: message.type(), text: message.text() });
    });
    const renderedConsoleErrors = (): string[] => consoleMessages.filter((m) => m.type === 'error').map((m) => m.text);

    const evidence: FlowEvidence[] = [];

    // ---------------------------------------------------------------------
    // Flow 1 — Genesis with daemon Switch left OFF (default)
    // ---------------------------------------------------------------------
    const flow1Snapshot = snapshotLogs(app);
    const flow1: FlowEvidence = { flow: 'Flow 1 (Genesis OFF)', passed: true, failures: [], notes: [] };
    evidence.push(flow1);

    try {
      await driveGenesisCustom(page, { name: offMindName, voiceDescription: 'a calm, methodical operator', purpose: 'Operator', toggleDaemon: false });
      await waitForMindByName(page, offMindName);

      // Disk: log.md exists and is empty (sentinel never seeded). .chamber.json
      // is absent — MindScaffold writes it ONLY on opt-in.
      const offLogPath = path.join(offMindPath, '.working-memory', 'log.md');
      const offChamberJson = path.join(offMindPath, '.chamber.json');
      const offLogContent = readFileOrNull(offLogPath);
      flow1.notes.push(`log.md exists: ${offLogContent !== null}, length: ${offLogContent?.length ?? 'n/a'}`);
      flow1.notes.push(`.chamber.json exists: ${fs.existsSync(offChamberJson)}`);
      if (offLogContent === null) flow1.failures.push('log.md missing for OFF mind');
      if (offLogContent && offLogContent.length !== 0) {
        flow1.failures.push(`log.md is not empty (${offLogContent.length} bytes) — sentinel may have been seeded`);
      }
      // chamber.json is allowed to be present with enabled=false OR absent. Per
      // current implementation it is absent (and loadChamberMindConfig defaults
      // to enabled=false).
      if (fs.existsSync(offChamberJson)) {
        const cfg = JSON.parse(fs.readFileSync(offChamberJson, 'utf-8'));
        const enabled = cfg?.workingMemory?.consolidation?.enabled;
        flow1.notes.push(`.chamber.json content: enabled=${enabled}`);
        if (enabled === true) flow1.failures.push('.chamber.json says enabled=true after Genesis OFF');
      }

      // Dream db must NOT exist
      const offDreamDb = path.join(offMindPath, '.working-memory', '.state', 'dream.db');
      flow1.notes.push(`dream.db exists: ${fs.existsSync(offDreamDb)}`);
      if (fs.existsSync(offDreamDb)) flow1.failures.push('dream.db should not exist for OFF mind');

      // Console: NO MindMemoryService activation logs reference the off mind path.
      // Activate success path is silent so absence is the assertion.
      const flow1Logs = logsSince(app, flow1Snapshot);
      const offActivationLines = flow1Logs.filter((l) => /\[MindMemoryService\]/i.test(l) && l.includes(offMindPath));
      flow1.notes.push(`MindMemoryService log lines mentioning OFF mind path: ${offActivationLines.length}`);
      if (offActivationLines.some((l) => /already activated|activate/i.test(l))) {
        flow1.failures.push(`Unexpected MindMemoryService activate trace for OFF mind: ${offActivationLines.join(' | ')}`);
      }

      // ARIA: open profile modal, switch should be OFF
      const offMindContext = await getMindContext(page, offMindName);
      flow1.notes.push(`OFF mindId: ${offMindContext.mindId}`);
      await openProfileModal(page, offMindName);
      const offSwitchInitial = await readSwitchAria(page);
      flow1.notes.push(`Profile Switch initial aria-checked for OFF mind: ${offSwitchInitial}`);
      if (offSwitchInitial !== 'false') {
        flow1.failures.push(`Profile Switch aria-checked expected "false" but was "${offSwitchInitial}"`);
      }
      await closeProfileModal(page);
    } catch (err) {
      flow1.failures.push(`Exception: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    } finally {
      flow1.passed = flow1.failures.length === 0;
      reportFlow(flow1);
    }

    // ---------------------------------------------------------------------
    // Flow 2 — Genesis with daemon Switch toggled ON
    // ---------------------------------------------------------------------
    const flow2Snapshot = snapshotLogs(app);
    const flow2: FlowEvidence = { flow: 'Flow 2 (Genesis ON)', passed: true, failures: [], notes: [] };
    evidence.push(flow2);

    try {
      await driveGenesisCustom(page, { name: onMindName, voiceDescription: 'a precise, observant analyst', purpose: 'Analyst', toggleDaemon: true });
      await waitForMindByName(page, onMindName);

      // Disk: log.md must start with sentinel and .chamber.json must say enabled=true
      const onLogPath = path.join(onMindPath, '.working-memory', 'log.md');
      const onChamberJson = path.join(onMindPath, '.chamber.json');
      const onLogContent = readFileOrNull(onLogPath);
      flow2.notes.push(`log.md exists: ${onLogContent !== null}, starts with sentinel: ${(onLogContent ?? '').startsWith('<!-- chamber-structured-log/v1 -->')}`);
      if (!(onLogContent ?? '').startsWith('<!-- chamber-structured-log/v1 -->')) {
        flow2.failures.push('log.md missing sentinel after Genesis ON');
      }
      if (!fs.existsSync(onChamberJson)) flow2.failures.push('.chamber.json missing after Genesis ON');
      else {
        const cfg = JSON.parse(fs.readFileSync(onChamberJson, 'utf-8'));
        flow2.notes.push(`.chamber.json: ${JSON.stringify(cfg)}`);
        if (cfg?.workingMemory?.consolidation?.enabled !== true) {
          flow2.failures.push(`.chamber.json consolidation.enabled expected true but was ${JSON.stringify(cfg?.workingMemory?.consolidation?.enabled)}`);
        }
      }

      // dream.db should be created on activation
      const onDreamDb = path.join(onMindPath, '.working-memory', '.state', 'dream.db');
      flow2.notes.push(`dream.db exists after Genesis ON: ${fs.existsSync(onDreamDb)}`);
      if (!fs.existsSync(onDreamDb)) flow2.failures.push('dream.db not created after Genesis ON activation');

      // ARIA: profile Switch should be ON
      const onMindContext = await getMindContext(page, onMindName);
      flow2.notes.push(`ON mindId: ${onMindContext.mindId}`);
      await openProfileModal(page, onMindName);
      const onSwitchInitial = await readSwitchAria(page);
      flow2.notes.push(`Profile Switch initial aria-checked for ON mind: ${onSwitchInitial}`);
      if (onSwitchInitial !== 'true') flow2.failures.push(`Profile Switch aria-checked expected "true" but was "${onSwitchInitial}"`);
      await closeProfileModal(page);

      // Send a chat turn via the IPC bridge — exercises real SDK + DailyLogWriter
      const chatResult = await sendOneShotTurn(page, onMindContext.mindId, 'Reply with the single word: ACK');
      flow2.notes.push(`chat assistantText length=${chatResult.assistantText.length}, error=${chatResult.errorMessage || '<none>'}, doneCount=${chatResult.doneCount}`);
      if (chatResult.errorMessage) flow2.failures.push(`Chat turn failed: ${chatResult.errorMessage}`);

      // Allow DailyLogWriter to flush (write happens async after done event).
      await delay(1500);
      const onLogAfterChat = readFileOrNull(onLogPath) ?? '';
      flow2.notes.push(`log.md size after chat: ${onLogAfterChat.length}`);
      flow2.notes.push(`log.md preview: ${preview(onLogAfterChat)}`);
      if (!onLogAfterChat.startsWith('<!-- chamber-structured-log/v1 -->')) {
        flow2.failures.push('log.md no longer starts with sentinel after chat turn (corrupted?)');
      }
      if (!/\n### user\n/.test(onLogAfterChat)) flow2.failures.push('log.md missing "### user" frame marker');
      if (!/\n### assistant\n/.test(onLogAfterChat)) flow2.failures.push('log.md missing "### assistant" frame marker');

      // No console errors emerged from the renderer during chat
      const errs = renderedConsoleErrors();
      if (errs.length > 0) flow2.notes.push(`renderer console errors: ${errs.length} (first: ${errs[0].slice(0, 200)})`);

      // Capture relevant main-process log lines for the report.
      const flow2Logs = logsSince(app, flow2Snapshot);
      flow2.notes.push(`relevant main logs (sample): ${sampleRelevant(flow2Logs).join(' | ')}`);
    } catch (err) {
      flow2.failures.push(`Exception: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    } finally {
      flow2.passed = flow2.failures.length === 0;
      reportFlow(flow2);
    }

    // ---------------------------------------------------------------------
    // Flow 3 — toggle the OFF mind ON via profile modal
    // ---------------------------------------------------------------------
    const flow3Snapshot = snapshotLogs(app);
    const flow3: FlowEvidence = { flow: 'Flow 3 (Post-genesis OFF→ON)', passed: true, failures: [], notes: [] };
    evidence.push(flow3);

    try {
      const offMindContext = await getMindContext(page, offMindName);
      // Set up a renderer-side mind:changed counter so we can attribute the reload sequence.
      await page.evaluate((mindId) => {
        const w = window as unknown as {
          __chamberDreamTest?: {
            unsubscribe?: () => void;
            mindId?: string;
            events: Array<{ ts: number; presentMindIds: string[] }>;
          };
        };
        if (w.__chamberDreamTest?.unsubscribe) w.__chamberDreamTest.unsubscribe();
        const events: Array<{ ts: number; presentMindIds: string[] }> = [];
        const unsubscribe = window.electronAPI.mind.onMindChanged((minds: { mindId: string }[]) => {
          events.push({ ts: Date.now(), presentMindIds: minds.map((m) => m.mindId) });
        });
        w.__chamberDreamTest = { unsubscribe, mindId, events };
      }, offMindContext.mindId);

      await openProfileModal(page, offMindName);
      const ariaBefore = await readSwitchAria(page);
      flow3.notes.push(`Switch aria-checked before toggle: ${ariaBefore}`);
      if (ariaBefore !== 'false') flow3.failures.push(`Pre-toggle aria-checked expected "false" but was "${ariaBefore}"`);

      const switchLocator = page.getByRole('switch', { name: 'Enable dream daemon' });
      await switchLocator.click();

      // Wait for ARIA to flip — mind reload + Copilot client cold-start can
      // take 30+ seconds, so give it 90s.
      await expect(switchLocator).toHaveAttribute('aria-checked', 'true', { timeout: 90_000 });
      const ariaAfter = await switchLocator.getAttribute('aria-checked');
      flow3.notes.push(`Switch aria-checked after toggle: ${ariaAfter}`);

      // Disk: .chamber.json should now exist with enabled=true
      const offChamberJson = path.join(offMindPath, '.chamber.json');
      const cfgRaw = readFileOrNull(offChamberJson);
      flow3.notes.push(`.chamber.json after toggle: ${cfgRaw ?? '<missing>'}`);
      if (!cfgRaw) flow3.failures.push('.chamber.json missing after toggle ON');
      else {
        const cfg = JSON.parse(cfgRaw);
        if (cfg?.workingMemory?.consolidation?.enabled !== true) {
          flow3.failures.push(`.chamber.json enabled expected true but was ${JSON.stringify(cfg?.workingMemory?.consolidation?.enabled)}`);
        }
      }

      // mind reload sequence: 2 onMindChanged events (unloaded + loaded)
      // First event should not contain the mindId; second event should.
      const reloadEvents = await page.evaluate(() => {
        const w = window as unknown as { __chamberDreamTest?: { events: Array<{ ts: number; presentMindIds: string[] }>; mindId: string } };
        return w.__chamberDreamTest ?? { events: [], mindId: '' };
      });
      flow3.notes.push(`onMindChanged event count: ${reloadEvents.events.length}`);
      const sawUnloaded = reloadEvents.events.some((e) => !e.presentMindIds.includes(offMindContext.mindId));
      const sawLoaded = reloadEvents.events.some((e) => e.presentMindIds.includes(offMindContext.mindId));
      flow3.notes.push(`saw unloaded event: ${sawUnloaded}, saw loaded event: ${sawLoaded}`);
      if (!sawUnloaded) flow3.failures.push('No mind:unloaded event observed (mind never absent from list during reload)');
      if (!sawLoaded) flow3.failures.push('No mind:loaded event observed after reload');

      // Disk: dream.db should now exist
      const offDreamDb = path.join(offMindPath, '.working-memory', '.state', 'dream.db');
      flow3.notes.push(`dream.db after toggle ON: ${fs.existsSync(offDreamDb)}`);
      if (!fs.existsSync(offDreamDb)) flow3.failures.push('dream.db missing after toggle ON (MindMemoryService failed to activate?)');

      await closeProfileModal(page);

      // Send a chat turn — must produce structured frames.
      const chatResult = await sendOneShotTurn(page, offMindContext.mindId, 'Reply with the single word: GO');
      flow3.notes.push(`chat assistantText length=${chatResult.assistantText.length}, error=${chatResult.errorMessage || '<none>'}`);
      if (chatResult.errorMessage) flow3.failures.push(`Chat turn after toggle ON failed: ${chatResult.errorMessage}`);

      await delay(1500);
      const offLogPath = path.join(offMindPath, '.working-memory', 'log.md');
      const offLogAfter = readFileOrNull(offLogPath) ?? '';
      flow3.notes.push(`log.md after chat (size=${offLogAfter.length}): ${preview(offLogAfter)}`);
      if (!offLogAfter.startsWith('<!-- chamber-structured-log/v1 -->')) {
        flow3.failures.push('log.md missing sentinel after toggle ON + chat (eager migrateIfNeeded should have seeded it)');
      }
      if (!/\n### user\n/.test(offLogAfter)) flow3.failures.push('log.md missing "### user" frame after toggle ON + chat');
      if (!/\n### assistant\n/.test(offLogAfter)) flow3.failures.push('log.md missing "### assistant" frame after toggle ON + chat');

      const flow3Logs = logsSince(app, flow3Snapshot);
      flow3.notes.push(`relevant main logs (sample): ${sampleRelevant(flow3Logs).join(' | ')}`);
    } catch (err) {
      flow3.failures.push(`Exception: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    } finally {
      flow3.passed = flow3.failures.length === 0;
      reportFlow(flow3);
    }

    // ---------------------------------------------------------------------
    // Flow 4 — toggle the ON mind OFF via profile modal (rollback path)
    // ---------------------------------------------------------------------
    const flow4Snapshot = snapshotLogs(app);
    const flow4: FlowEvidence = { flow: 'Flow 4 (Post-genesis ON→OFF rollback)', passed: true, failures: [], notes: [] };
    evidence.push(flow4);

    try {
      const onMindContext = await getMindContext(page, onMindName);

      // Reset onMindChanged counter for this mind.
      await page.evaluate((mindId) => {
        const w = window as unknown as {
          __chamberDreamTest?: {
            unsubscribe?: () => void;
            mindId?: string;
            events: Array<{ ts: number; presentMindIds: string[] }>;
          };
        };
        if (w.__chamberDreamTest?.unsubscribe) w.__chamberDreamTest.unsubscribe();
        const events: Array<{ ts: number; presentMindIds: string[] }> = [];
        const unsubscribe = window.electronAPI.mind.onMindChanged((minds: { mindId: string }[]) => {
          events.push({ ts: Date.now(), presentMindIds: minds.map((m) => m.mindId) });
        });
        w.__chamberDreamTest = { unsubscribe, mindId, events };
      }, onMindContext.mindId);

      await openProfileModal(page, onMindName);
      const ariaBefore = await readSwitchAria(page);
      flow4.notes.push(`Switch aria-checked before toggle: ${ariaBefore}`);
      if (ariaBefore !== 'true') flow4.failures.push(`Pre-toggle aria-checked expected "true" but was "${ariaBefore}"`);

      const switchLocator = page.getByRole('switch', { name: 'Enable dream daemon' });
      await switchLocator.click();
      await expect(switchLocator).toHaveAttribute('aria-checked', 'false', { timeout: 90_000 });
      const ariaAfter = await switchLocator.getAttribute('aria-checked');
      flow4.notes.push(`Switch aria-checked after toggle: ${ariaAfter}`);

      // Disk: .chamber.json now enabled=false
      const onChamberJson = path.join(onMindPath, '.chamber.json');
      const cfgRaw = readFileOrNull(onChamberJson);
      flow4.notes.push(`.chamber.json after rollback: ${cfgRaw ?? '<missing>'}`);
      if (!cfgRaw) flow4.failures.push('.chamber.json removed unexpectedly');
      else {
        const cfg = JSON.parse(cfgRaw);
        if (cfg?.workingMemory?.consolidation?.enabled !== false) {
          flow4.failures.push(`.chamber.json enabled expected false but was ${JSON.stringify(cfg?.workingMemory?.consolidation?.enabled)}`);
        }
      }

      // Console: rollback log line
      const flow4Logs = logsSince(app, flow4Snapshot);
      const rollbackLogLines = flow4Logs.filter((l) => /\[rollbackToUnstructured\]/.test(l));
      flow4.notes.push(`rollback log lines: ${rollbackLogLines.length}`);
      flow4.notes.push(`rollback log preview: ${rollbackLogLines.map(preview).join(' | ')}`);
      if (!rollbackLogLines.some((l) => /converted \d+ frame\(s\)/.test(l))) {
        flow4.failures.push('Expected "[rollbackToUnstructured] converted N frame(s)" log line not found');
      }

      // log.md no longer has sentinel; should have rendered turn markdown
      const onLogPath = path.join(onMindPath, '.working-memory', 'log.md');
      const onLogAfterRollback = readFileOrNull(onLogPath) ?? '';
      flow4.notes.push(`log.md after rollback (size=${onLogAfterRollback.length}): ${preview(onLogAfterRollback)}`);
      if (onLogAfterRollback.includes('<!-- chamber-structured-log/v1 -->')) {
        flow4.failures.push('log.md still contains sentinel after rollback');
      }
      if (!/^## \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.*— turn .*\(/m.test(onLogAfterRollback)) {
        flow4.failures.push('log.md missing rendered turn header (## <ISO> — turn <id> (<model>))');
      }
      if (!/\*\*User\*\*:/.test(onLogAfterRollback)) flow4.failures.push('log.md missing **User**: block');
      if (!/\*\*Assistant\*\*:/.test(onLogAfterRollback)) flow4.failures.push('log.md missing **Assistant**: block');

      // legacy file should not exist (Genesis-time seed never had legacy content)
      const legacyPath = path.join(onMindPath, '.working-memory', 'log.legacy.md');
      flow4.notes.push(`log.legacy.md exists after rollback: ${fs.existsSync(legacyPath)}`);
      if (fs.existsSync(legacyPath)) flow4.failures.push('log.legacy.md should be removed (or absent) after rollback');

      // mind reload events
      const reloadEvents = await page.evaluate(() => {
        const w = window as unknown as { __chamberDreamTest?: { events: Array<{ ts: number; presentMindIds: string[] }>; mindId: string } };
        return w.__chamberDreamTest ?? { events: [], mindId: '' };
      });
      flow4.notes.push(`onMindChanged event count: ${reloadEvents.events.length}`);
      const sawUnloaded = reloadEvents.events.some((e) => !e.presentMindIds.includes(onMindContext.mindId));
      const sawLoaded = reloadEvents.events.some((e) => e.presentMindIds.includes(onMindContext.mindId));
      flow4.notes.push(`saw unloaded event: ${sawUnloaded}, saw loaded event: ${sawLoaded}`);
      if (!sawUnloaded) flow4.failures.push('No mind:unloaded event observed during rollback toggle');
      if (!sawLoaded) flow4.failures.push('No mind:loaded event observed after rollback toggle');

      await closeProfileModal(page);

      // Follow-up turn: appends unstructured to log.md (no sentinel re-introduced).
      const chatResult = await sendOneShotTurn(page, onMindContext.mindId, 'Reply with the single word: STOP');
      flow4.notes.push(`follow-up chat assistantText length=${chatResult.assistantText.length}, error=${chatResult.errorMessage || '<none>'}`);
      if (chatResult.errorMessage) flow4.failures.push(`Follow-up chat turn failed: ${chatResult.errorMessage}`);
      await delay(1500);

      const onLogAfterFollowUp = readFileOrNull(onLogPath) ?? '';
      flow4.notes.push(`log.md after follow-up (size=${onLogAfterFollowUp.length}): ${preview(onLogAfterFollowUp)}`);
      if (onLogAfterFollowUp.includes('<!-- chamber-structured-log/v1 -->')) {
        flow4.failures.push('Follow-up turn re-introduced sentinel — DailyLogWriter not torn down');
      }
      // Note: post-rollback the mind is in opted-out mode. A turn through the
      // chat IPC does NOT write to log.md (no observer is attached). We simply
      // verify the file did not regress.

      flow4.notes.push(`relevant main logs (sample): ${sampleRelevant(flow4Logs).join(' | ')}`);
    } catch (err) {
      flow4.failures.push(`Exception: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    } finally {
      flow4.passed = flow4.failures.length === 0;
      reportFlow(flow4);
    }

    // ---------------------------------------------------------------------
    // Final consolidated assertion
    // ---------------------------------------------------------------------
    const failedFlows = evidence.filter((e) => !e.passed);
    if (failedFlows.length > 0) {
      const summary = failedFlows
        .map((e) => `${e.flow}\n  failures:\n    - ${e.failures.join('\n    - ')}\n  notes:\n    - ${e.notes.join('\n    - ')}`)
        .join('\n\n');
      throw new Error(`Dream daemon validation failed:\n${summary}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function snapshotLogs(app: LaunchedElectronApp | undefined): number {
  return app?.logs.length ?? 0;
}

function logsSince(app: LaunchedElectronApp | undefined, start: number): string[] {
  return (app?.logs ?? []).slice(start);
}

function readFileOrNull(p: string): string | null {
  try {
    return fs.readFileSync(p, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

function preview(s: string, max = 240): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : flat.slice(0, max) + '…';
}

function sampleRelevant(lines: string[]): string[] {
  return lines
    .filter((l) =>
      /\[MindMemoryService\]|\[MindManager\]|\[rollbackToUnstructured\]|\[chamberMindConfig\]|\[DailyLogWriter\]|mind:loaded|mind:unloaded|mindMemory/i.test(l),
    )
    .slice(0, 8)
    .map((l) => l.replace(/\r?\n/g, ' ').slice(0, 200));
}

function reportFlow(f: FlowEvidence): void {
  const status = f.passed ? 'PASS' : 'FAIL';
   
  console.log(`[dream-daemon-bidir] ${status} — ${f.flow}`);
  for (const n of f.notes) console.log(`  · ${n}`);
  for (const x of f.failures) console.log(`  ✗ ${x}`);
}

interface DriveGenesisOptions {
  name: string;
  voiceDescription: string;
  purpose: string;
  toggleDaemon: boolean;
}

async function driveGenesisCustom(page: Awaited<ReturnType<typeof findRendererPage>>, opts: DriveGenesisOptions): Promise<void> {
  // The genesis wizard is reachable from three different entry states:
  //   1. We're already in the wizard (VoidScreen) — "Begin" button is visible.
  //   2. We're on the LandingScreen (first launch, no minds) — "New Agent" button is visible.
  //   3. We're in the main app (at least one mind exists) — the sidebar shows "Add Agent",
  //      which dispatches SHOW_LANDING and brings us to state (2).
  const beginButton = page.getByRole('button', { name: 'Begin', exact: true });
  const newAgentButton = page.getByRole('button', { name: /New Agent/i });

  const beginVisible = await beginButton.isVisible().catch(() => false);
  if (!beginVisible) {
    const newAgentVisible = await newAgentButton.isVisible().catch(() => false);
    if (!newAgentVisible) {
      // State (3) — sidebar route.
      const addAgentButton = page.getByRole('button', { name: /Add Agent/i });
      await addAgentButton.waitFor({ state: 'visible', timeout: 30_000 });
      await addAgentButton.click();
      await newAgentButton.waitFor({ state: 'visible', timeout: 10_000 });
    }
    await newAgentButton.click();
  }
  await beginButton.waitFor({ state: 'visible', timeout: 30_000 });
  await beginButton.click();

  // VoiceScreen — pick "Someone else..." then enter name + backstory.
  await page.getByRole('button', { name: /Someone else/i }).click();
  await page.getByPlaceholder('e.g. Tony Stark, Moneypenny, Gandalf...').fill(opts.name);
  await page.getByPlaceholder(/Era, source material/).fill(opts.voiceDescription);
  await page.getByRole('button', { name: /Research this voice/i }).click();
  await expect(page.getByLabel('Research brief')).toHaveValue(/.+/, { timeout: 60_000 });
  await page.getByRole('button', { name: /Continue to purpose/i }).click();

  // RoleScreen — pick "Something else..." then type purpose. Optionally toggle the dream-daemon Switch BEFORE submit.
  await page.getByRole('button', { name: /Something else/i }).click();
  await page.getByPlaceholder(/Creative Director, Debate Coach/).fill(opts.purpose);

  if (opts.toggleDaemon) {
    const daemonSwitch = page.getByRole('switch', { name: 'Enable dream daemon' });
    await expect(daemonSwitch).toHaveAttribute('aria-checked', 'false');
    await daemonSwitch.click();
    await expect(daemonSwitch).toHaveAttribute('aria-checked', 'true');
  }

  await page.getByRole('button', { name: /That's my purpose/i }).click();

  // BootScreen → done. The chat input becomes visible only once Genesis completes
  // and the new mind is selected. Wait long enough for SOUL generation + capability bootstrap.
  await expect(page.getByPlaceholder('Message your agent… (paste an image to attach)')).toBeEnabled({ timeout: 10 * 60_000 });
}

async function waitForMindByName(page: Awaited<ReturnType<typeof findRendererPage>>, name: string): Promise<void> {
  await expect.poll(
    async () =>
      await page.evaluate(async (target) => {
        const minds = await window.electronAPI.mind.list();
        return minds.some((m) => m.identity.name === target);
      }, name),
    { timeout: 30_000 },
  ).toBe(true);
}

interface MindCtx {
  mindId: string;
  mindPath: string;
}

async function getMindContext(page: Awaited<ReturnType<typeof findRendererPage>>, name: string): Promise<MindCtx> {
  return await page.evaluate(async (target) => {
    const minds = await window.electronAPI.mind.list();
    const mind = minds.find((m) => m.identity.name === target);
    if (!mind) throw new Error(`Mind ${target} not found`);
    return { mindId: mind.mindId, mindPath: mind.mindPath };
  }, name);
}

async function openProfileModal(page: Awaited<ReturnType<typeof findRendererPage>>, name: string): Promise<void> {
  const trigger = page.getByRole('button', { name: `Edit ${name} profile`, exact: true });
  // The trigger is hover-revealed (opacity-0). force:true bypasses the visibility check.
  await trigger.click({ force: true });
  await expect(page.getByRole('dialog').getByText('Agent profile')).toBeVisible({ timeout: 10_000 });
}

async function readSwitchAria(page: Awaited<ReturnType<typeof findRendererPage>>): Promise<string | null> {
  return await page.getByRole('switch', { name: 'Enable dream daemon' }).getAttribute('aria-checked');
}

async function closeProfileModal(page: Awaited<ReturnType<typeof findRendererPage>>): Promise<void> {
  // The dialog has two "Close" elements (footer text button + Radix icon button with aria-label="Close").
  // Press Escape — Radix Dialog dismisses on Escape and avoids selector ambiguity.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 5_000 }).catch(() => undefined);
}

interface ChatResult {
  assistantText: string;
  errorMessage: string;
  doneCount: number;
}

async function sendOneShotTurn(
  page: Awaited<ReturnType<typeof findRendererPage>>,
  mindId: string,
  prompt: string,
): Promise<ChatResult> {
  return await page.evaluate(async ({ mindId: id, prompt: text }) => {
    const messageId = `dream-daemon-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let assistantText = '';
    let errorMessage = '';
    let doneCount = 0;
    let resolveTerminal: () => void = () => undefined;
    const terminal = new Promise<void>((resolve) => { resolveTerminal = resolve; });
    const unsubscribe = window.electronAPI.chat.onEvent((eventMindId, eventMessageId, event) => {
      if (eventMindId !== id || eventMessageId !== messageId) return;
      if (event.type === 'chunk' || event.type === 'message_final') {
        assistantText += (event as { content?: string }).content ?? '';
      }
      if (event.type === 'error') {
        errorMessage = (event as { message?: string }).message ?? 'unknown error';
        resolveTerminal();
      }
      if (event.type === 'done') {
        doneCount += 1;
        resolveTerminal();
      }
    });
    try {
      const send = window.electronAPI.chat.send(id, text, messageId);
      const timeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Chat turn timed out after 180s')), 180_000);
      });
      await Promise.race([Promise.all([send, terminal]), timeout]);
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
    } finally {
      unsubscribe();
    }
    return { assistantText, errorMessage, doneCount };
  }, { mindId, prompt });
}

async function removeTempRoot(root: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM' || attempt === 9) {
         
        console.warn(`[dream-daemon-bidir] Failed to remove temp root ${root}:`, error);
        return;
      }
      await delay(250);
    }
  }
}
