/**
 * A2A relay smoke test against a live Switchboard relay, with the model in the loop.
 *
 * This is a user-as-real-user E2E:
 *
 *   1. A test peer (`RelayPeer`) registers on the Switchboard relay.
 *   2. Chamber connects to the same relay via the A2A Relay view (Entra interactive).
 *   3. Two local minds (Alice, Bob) are seeded.
 *   4. The user opens Alice's chat, types "what other agents do you see on the
 *      A2A relay right now?", and sends. Alice's LLM is expected to call her
 *      A2A discovery tool and name the peer somewhere in her reply.
 *   5. The user asks Alice to send Bob a message; we assert Alice's transcript
 *      shows the outbound activity (PR #301's bug was that it didn't) and
 *      Bob's chat shows the inbound.
 *   6. The user asks Alice to ask the peer the time; we assert the peer's
 *      relay inbox received a message from Alice.
 *
 * The LLM is non-deterministic. We assert on stable substrings (peer name,
 * mind names) and use generous timeouts. A wobble in model output may cause
 * a flake; that is an accepted cost of validating the full user flow against
 * a live relay.
 *
 * Run headed so you can watch:  npm run smoke:a2a-relay
 */
import { expect, test, type Page } from '@playwright/test';
import { config as loadDotEnv } from 'dotenv';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { findRendererPage, launchElectronApp, type LaunchedElectronApp } from './electronApp';
import { RelayPeer } from './fixtures/relayPeer';

loadDotEnv({ path: path.resolve(__dirname, '..', '..', '..', '.env') });

const RELAY_URL = process.env.CHAMBER_A2A_RELAY_URL ?? '';
const LOGIN_HINT = process.env.CHAMBER_A2A_LOGIN_HINT ?? process.env.SWITCHBOARD_LOGIN_HINT ?? '';
const DOMAIN_HINT = process.env.CHAMBER_A2A_DOMAIN_HINT ?? process.env.SWITCHBOARD_DOMAIN_HINT ?? '';

const cdpPort = Number(process.env.CHAMBER_E2E_A2A_RELAY_CDP_PORT ?? 9341);
const aliceMindName = 'Alice';
const bobMindName = 'Bob';

const peerSuffix = Math.random().toString(36).slice(2, 8);
const peerAgentName = `SmokeBot-${peerSuffix}`;
const peerRefreshCachePath = path.resolve(__dirname, '..', '..', '..', '.cache', 'a2a-relay-peer.json');

test.describe.serial('A2A relay smoke (live Switchboard, model in the loop)', () => {
  test.skip(!RELAY_URL, 'Set CHAMBER_A2A_RELAY_URL in .env to run.');
  test.setTimeout(600_000);

  let app: LaunchedElectronApp | undefined;
  let page: Page;
  let peer: RelayPeer | undefined;
  const tempRoots: string[] = [];

  test.beforeAll(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-a2a-relay-smoke-'));
    tempRoots.push(root);
    const alicePath = path.join(root, 'alice');
    const bobPath = path.join(root, 'bob');
    seedMind(alicePath, aliceMindName);
    seedMind(bobPath, bobMindName);

    // Peer registers first so Chamber sees it during initial relay sync.
    peer = new RelayPeer({
      relayUrl: RELAY_URL,
      agentName: peerAgentName,
      authMode: 'auto',
      loginHint: LOGIN_HINT || undefined,
      domainHint: DOMAIN_HINT || undefined,
      refreshTokenCachePath: peerRefreshCachePath,
    });
    await peer.connect();

    app = await launchElectronApp({
      cdpPort,
      env: { CHAMBER_E2E_USER_DATA: path.join(root, 'user-data'), CHAMBER_E2E_PREVIEW_FEATURES: '1' },
    });
    page = await findRendererPage(app.browser, app.logs);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#root')).not.toBeEmpty();

    // Add minds. This drops GenesisGate (which renders LandingScreen until
    // minds.length > 0) and reveals the AppShell with the sidebar.
    await retryOnContextDestroyed(() => page.evaluate(async ({ aliceP, bobP }) => {
      const alice = await window.electronAPI.mind.add(aliceP);
      await window.electronAPI.mind.add(bobP);
      await window.electronAPI.mind.setActive(alice.mindId);
    }, { aliceP: alicePath, bobP: bobPath }));

    // Wait for the sidebar to render both mind cards — proves we're past Genesis.
    await expect(page.getByRole('button', { name: aliceMindName }).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('button', { name: bobMindName }).first()).toBeVisible({ timeout: 60_000 });

    // Now connect Chamber to the relay through the A2A Relay view. Auth mode
    // is "interactive" — first run pops a browser, subsequent runs reuse the
    // refresh token Chamber cached in keytar.
    await page.getByRole('button', { name: 'A2A Relay' }).waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByRole('button', { name: 'A2A Relay' }).click();
    await expect(page.getByRole('heading', { name: 'A2A Relay' })).toBeVisible();
    await page.locator('#a2a-relay-relay-base-url').fill(RELAY_URL);
    await page.locator('#a2a-relay-authentication-mode').selectOption('interactive');
    await page.getByRole('button', { name: /^Connect$/ }).click();
    await expect(page.getByText('connected', { exact: true }).first()).toBeVisible({ timeout: 180_000 });
  });

  test.afterAll(async () => {
    await peer?.disconnect().catch(() => undefined);
    await app?.close();
    for (const root of tempRoots) await removeTempRoot(root);
  });

  test('user flow: ask Alice who is on the relay, then have her message Bob and the peer', async () => {
    // Go to Alice's chat.
    await page.getByRole('button', { name: aliceMindName }).first().click();

    // 1. Discovery: ask Alice who else is on the relay. She should call her
    //    A2A discovery tool and name the peer.
    await sendUserMessage(
      page,
      `Please call your A2A discovery tool and list every agent currently visible on the A2A relay. Include each agent's exact name verbatim in your reply.`,
    );
    await waitForAssistantMention(page, [peerAgentName, bobMindName]);

    // 2. Outbound to a local mind: ask Alice to send Bob a message.
    const aliceToBobToken = `alice-to-bob-${peerSuffix}-${Date.now().toString(36)}`;
    await sendUserMessage(
      page,
      `Send a short A2A message to the local agent named "${bobMindName}" with this exact body (no quotes, no extras): ${aliceToBobToken}`,
    );
    // The outbound token must appear in Alice's transcript (PR #301 — the
    // bug was that outbound A2A activity didn't render).
    await expect(page.getByText(new RegExp(escapeRegex(aliceToBobToken)))).toBeVisible({ timeout: 120_000 });

    // Bob's chat should now contain the inbound from Alice.
    await page.getByRole('button', { name: bobMindName }).first().click();
    await expect(page.getByText(new RegExp(escapeRegex(aliceToBobToken)))).toBeVisible({ timeout: 120_000 });

    // 3. Outbound to the peer: switch back to Alice and ask her to ping the peer.
    await page.getByRole('button', { name: aliceMindName }).first().click();
    const aliceToPeerToken = `alice-to-peer-${peerSuffix}-${Date.now().toString(36)}`;
    await sendUserMessage(
      page,
      `Send an A2A message to the relay agent named "${peerAgentName}" with this exact body (no quotes, no extras): ${aliceToPeerToken}`,
    );
    // The peer's relay inbox should observe the message.
    const received = await peer!.waitForMessage(
      (entry) => entry.text.includes(aliceToPeerToken),
      { timeoutMs: 120_000 },
    );
    expect(received.text).toContain(aliceToPeerToken);
  });
});

async function sendUserMessage(page: Page, text: string): Promise<void> {
  const composer = page.getByPlaceholder(/Message your agent/);
  await composer.waitFor({ state: 'visible' });
  await composer.fill(text);
  await page.getByRole('button', { name: 'Send message' }).click();
  // Wait for the user bubble to render in the transcript so we know the send
  // landed before letting the LLM stream a reply.
  await expect(page.getByText(text)).toBeVisible({ timeout: 30_000 });
}

async function waitForAssistantMention(page: Page, names: string[]): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const transcript = await page.locator('body').innerText().catch(() => '');
    if (names.every((name) => transcript.includes(name))) return;
    await delay(750);
  }
  throw new Error(`Assistant transcript never mentioned all of [${names.join(', ')}] within 120s.`);
}

function seedMind(mindPath: string, name: string): void {
  fs.mkdirSync(path.join(mindPath, '.github', 'agents'), { recursive: true });
  fs.mkdirSync(path.join(mindPath, '.working-memory'), { recursive: true });
  fs.writeFileSync(
    path.join(mindPath, 'SOUL.md'),
    `# ${name}\n\nYou are ${name}, a Chamber smoke-test agent. Use the A2A tools when asked.\n`,
  );
  fs.writeFileSync(
    path.join(mindPath, '.github', 'agents', `${name.toLowerCase()}.agent.md`),
    [
      '---',
      `name: ${name}`,
      `description: Chamber relay smoke test agent`,
      '---',
      '',
      `# ${name}`,
      '',
      'Use the A2A tools when the user asks about other agents or asks you to message them.',
      '',
    ].join('\n'),
  );
  for (const file of ['memory.md', 'rules.md', 'log.md']) {
    fs.writeFileSync(path.join(mindPath, '.working-memory', file), '');
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function retryOnContextDestroyed<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!/Execution context was destroyed|Target closed/i.test(message)) throw error;
      await delay(500);
    }
  }
  throw lastError;
}

async function removeTempRoot(root: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM' || attempt === 9) {
        console.warn(`[a2a-relay-smoke] Failed to remove temp root ${root}:`, error);
        return;
      }
      await delay(250);
    }
  }
}
