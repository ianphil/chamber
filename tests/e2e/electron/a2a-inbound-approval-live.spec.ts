import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { findRendererPage, launchElectronApp, type LaunchedElectronApp } from './electronApp';

const RELAY_URL = process.env.CHAMBER_A2A_APPROVAL_RELAY_URL ?? '';
const CLIENT_ID = process.env.CHAMBER_A2A_APPROVAL_CLIENT_ID ?? '';
const TENANT_ID = process.env.CHAMBER_A2A_APPROVAL_TENANT_ID ?? '';
const A_ACCESS_TOKEN = process.env.CHAMBER_A2A_APPROVAL_A_ACCESS_TOKEN ?? '';
const A_REFRESH_TOKEN = process.env.CHAMBER_A2A_APPROVAL_A_REFRESH_TOKEN ?? '';
const B_REFRESH_TOKEN = process.env.CHAMBER_A2A_APPROVAL_B_REFRESH_TOKEN ?? '';
const executablePath = path.resolve(__dirname, '..', '..', '..', 'out', 'Chamber-win32-x64', 'Chamber.exe');

interface Instance {
  app: LaunchedElectronApp;
  page: Page;
  root: string;
  userData: string;
  mindPath: string;
  mindId: string;
  cardName: string;
  refreshToken: string;
}

test.describe.serial('live inbound A2A approval', () => {
  test.skip(
    !RELAY_URL || !CLIENT_ID || !TENANT_ID || !A_ACCESS_TOKEN || !A_REFRESH_TOKEN || !B_REFRESH_TOKEN,
    'Live approval relay credentials are required.',
  );
  test.setTimeout(600_000);

  let a1: Instance;
  let a2: Instance;
  let b1: Instance;

  test.beforeAll(async () => {
    test.setTimeout(600_000);
    a1 = await launchInstance('Approval A1', A_REFRESH_TOKEN);
    a2 = await launchInstance('Approval A2', A_REFRESH_TOKEN);
    b1 = await launchInstance('Approval B1', B_REFRESH_TOKEN);
  });

  test.afterAll(async () => {
    await Promise.allSettled([a1, a2, b1].filter(Boolean).map((instance) => closeInstance(instance)));
  });

  test('same-owner traffic bypasses approval', async () => {
    const marker = `same-owner-${Date.now()}`;
    await sendRelayMessage(A_ACCESS_TOKEN, a2.cardName, a1, marker);

    await expect(a2.page.getByText(marker, { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(a2.page.getByRole('heading', { name: 'External agent request' })).toHaveCount(0);
  });

  test('external traffic waits for approve once and delivers exactly once', async () => {
    const marker = `approve-once-${Date.now()}`;
    const sent = await sendRelayMessage(A_ACCESS_TOKEN, b1.cardName, a1, marker);

    await expect(b1.page.getByRole('heading', { name: 'External agent request' })).toBeVisible({ timeout: 60_000 });
    await expect(b1.page.getByText(marker, { exact: true })).toHaveCount(1);
    await b1.page.getByRole('button', { name: /Review inbound request/ }).click();
    await expect(b1.page.getByRole('heading', { name: 'Review inbound A2A request' })).toBeVisible();
    await b1.page.getByRole('button', { name: 'Approve once' }).click();

    await expect(b1.page.getByRole('heading', { name: 'External agent request' })).toHaveCount(0);
    await expect(b1.page.getByText(marker, { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(b1.page.getByText(marker, { exact: true })).toHaveCount(1);
    await expect.poll(() => getDisposition(sent.queueMessageId)).toBe('delivered');
  });

  test('decline is terminal and never reaches chat', async () => {
    const marker = `decline-${Date.now()}`;
    const sent = await sendRelayMessage(A_ACCESS_TOKEN, b1.cardName, a1, marker);

    await expect(b1.page.getByRole('heading', { name: 'External agent request' })).toBeVisible({ timeout: 60_000 });
    await b1.page.getByRole('button', { name: /Decline inbound request/ }).click();
    await expect(b1.page.getByRole('heading', { name: 'External agent request' })).toHaveCount(0);
    await expect(b1.page.getByText(marker, { exact: true })).toHaveCount(0);
    await expect.poll(() => getDisposition(sent.queueMessageId)).toBe('declined');
  });

  test('pending approval survives a Chamber restart', async () => {
    const marker = `restart-${Date.now()}`;
    await sendRelayMessage(A_ACCESS_TOKEN, b1.cardName, a1, marker);
    await expect(b1.page.getByRole('heading', { name: 'External agent request' })).toBeVisible({ timeout: 60_000 });

    const previous = b1;
    await previous.app.close();
    b1 = await launchInstance('Approval B1', B_REFRESH_TOKEN, previous);

    await expect(b1.page.getByRole('heading', { name: 'External agent request' })).toBeVisible({ timeout: 60_000 });
    await expect(b1.page.getByText(marker, { exact: true })).toHaveCount(1);
    await b1.page.getByRole('button', { name: /Decline inbound request/ }).click();
    await expect(b1.page.getByText(marker, { exact: true })).toHaveCount(0);
  });
});

async function launchInstance(name: string, refreshToken: string, previous?: Instance): Promise<Instance> {
  const root = previous?.root ?? fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-a2a-approval-live-'));
  const userData = previous?.userData ?? path.join(root, 'user-data');
  const mindPath = previous?.mindPath ?? path.join(root, 'mind');
  const mindId = previous?.mindId ?? `${name.toLowerCase().replaceAll(' ', '-')}-${crypto.randomUUID().slice(0, 4)}`;
  if (!previous) {
    seedMind(mindPath, name);
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({
      version: 2,
      minds: [{ id: mindId, path: mindPath }],
      activeMindId: mindId,
      activeLogin: 'ianphil_microsoft',
      theme: 'dark',
      marketplaceRegistries: [],
    }, null, 2));
  }
  const cdpPort = await getAvailablePort();
  const app = await launchElectronApp({
    cdpPort,
    executablePath,
    env: {
      CHAMBER_E2E_A2A_FAKE_DELIVERY: '1',
      CHAMBER_E2E_A2A_REFRESH_TOKEN: refreshToken,
      CHAMBER_E2E_PREVIEW_FEATURES: '1',
      CHAMBER_E2E_USER_DATA: userData,
    },
  });
  const page = await findRendererPage(app.browser, app.logs);
  await page.waitForLoadState('domcontentloaded');
  const card = await expect.poll(async () => {
    const cards = await page.evaluate(() => window.electronAPI.a2a.listAgents());
    return cards.find((candidate) => candidate.mindId === mindId) ?? null;
  }, { timeout: 180_000 }).not.toBeNull().then(async () => {
    const cards = await page.evaluate(() => window.electronAPI.a2a.listAgents());
    return cards.find((candidate) => candidate.mindId === mindId);
  });
  if (!card) throw new Error(`Local A2A card not found for ${name}`);
  await page.evaluate(async ({ relayUrl, clientId, tenantId }) => {
    await window.electronAPI.a2a.relayConnect({
      relayBaseUrl: relayUrl,
      authMode: 'interactive',
      clientId,
      tenantId,
      scope: `api://${clientId}/user_impersonation`,
    });
  }, { relayUrl: RELAY_URL, clientId: CLIENT_ID, tenantId: TENANT_ID });
  return { app, page, root, userData, mindPath, mindId, cardName: card.name, refreshToken };
}

async function closeInstance(instance: Instance): Promise<void> {
  await instance.app.close().catch(() => undefined);
  fs.rmSync(instance.root, { recursive: true, force: true });
}

async function getAvailablePort(): Promise<number> {
  const net = await import('node:net');
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to allocate a CDP port.'));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function sendRelayMessage(
  accessToken: string,
  recipient: string,
  sender: Instance,
  text: string,
): Promise<{ queueMessageId: string }> {
  const response = await fetch(`${RELAY_URL}/api/a2a/message:send`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      recipient,
      message: {
        messageId: crypto.randomUUID(),
        role: 'ROLE_USER',
        parts: [{ text, mediaType: 'text/plain' }],
        metadata: { fromId: sender.mindId, fromName: sender.cardName },
      },
      configuration: { returnImmediately: true },
    }),
  });
  if (!response.ok) throw new Error(`Relay send failed with HTTP ${response.status}: ${await response.text()}`);
  return response.json() as Promise<{ queueMessageId: string }>;
}

async function getDisposition(messageId: string): Promise<string | null> {
  const response = await fetch(`${RELAY_URL}/api/a2a/messages/${encodeURIComponent(messageId)}/status`, {
    headers: { authorization: `Bearer ${A_ACCESS_TOKEN}` },
  });
  if (!response.ok) throw new Error(`Relay status failed with HTTP ${response.status}`);
  const body = await response.json() as { disposition?: string | null };
  return body.disposition ?? null;
}

function seedMind(mindPath: string, name: string): void {
  fs.mkdirSync(path.join(mindPath, '.github', 'agents'), { recursive: true });
  fs.mkdirSync(path.join(mindPath, '.working-memory'), { recursive: true });
  fs.writeFileSync(path.join(mindPath, 'SOUL.md'), `# ${name}\n\nYou are ${name}.\n`);
  fs.writeFileSync(
    path.join(mindPath, '.github', 'agents', 'agent.agent.md'),
    `---\nname: ${name}\ndescription: Live A2A approval test agent\n---\n`,
  );
  for (const file of ['memory.md', 'rules.md', 'log.md']) {
    fs.writeFileSync(path.join(mindPath, '.working-memory', file), '');
  }
}
