import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import type { ByoLlmConfig, ChatEvent, MindContext } from '@chamber/shared/types';
import { modelSelectionKeyFromModel, modelSelectionKey } from '@chamber/shared/model-selection';
import { findRendererPage, launchElectronApp, type LaunchedElectronApp } from './electronApp';

const cdpPort = Number(process.env.CHAMBER_E2E_BYO_LLM_CDP_PORT ?? 9345);
const localRelayCdpPort = Number(process.env.CHAMBER_E2E_BYO_LLM_LOCAL_CDP_PORT ?? 9346);
const localRelayModel = 'local-e2e-gemma';
const localRelaySentinel = 'BYO_LOCAL_RELAY_SENTINEL';

/**
 * Real BYO LLM endpoint used by the FVT.
 *
 * Defaults to a local Ollama instance (http://localhost:11434/v1), which
 * exposes an OpenAI-compatible /models and /chat/completions surface. Override
 * via CHAMBER_E2E_BYO_LLM_BASE_URL when running against another local/provider
 * endpoint. Optional custom-header pair (CHAMBER_E2E_BYO_LLM_HEADER_NAME +
 * _HEADER_VALUE) is only applied when both are set.
 *
 * Tests in this block probe the endpoint up-front. If it doesn't respond, the
 * live-endpoint FVT is skipped so disconnected dev runs stay green. The
 * deterministic provider-routing coverage lives in the local-relay block
 * below and runs without any external dependency.
 */
const BYO_BASE_URL = process.env.CHAMBER_E2E_BYO_LLM_BASE_URL
  ?? 'http://localhost:11434/v1';
const BYO_API_KEY = process.env.CHAMBER_E2E_BYO_LLM_API_KEY ?? 'ollama';
const BYO_HEADER_NAME = process.env.CHAMBER_E2E_BYO_LLM_HEADER_NAME ?? '';
const BYO_HEADER_VALUE = process.env.CHAMBER_E2E_BYO_LLM_HEADER_VALUE ?? '';
const BYO_PREFERRED_MODEL = process.env.CHAMBER_E2E_BYO_LLM_MODEL ?? 'gemma4:e4b-it-q4_K_M';
const BYO_CUSTOM_HEADERS: Record<string, string> | undefined = BYO_HEADER_NAME && BYO_HEADER_VALUE
  ? { [BYO_HEADER_NAME]: BYO_HEADER_VALUE }
  : undefined;

async function probeEndpointAvailable(): Promise<{ ok: boolean; modelCount: number; modelIds: string[]; reason?: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${BYO_API_KEY}`,
    };
    if (BYO_CUSTOM_HEADERS) Object.assign(headers, BYO_CUSTOM_HEADERS);
    const response = await fetch(`${BYO_BASE_URL.replace(/\/$/, '')}/models`, {
      headers,
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) {
      return { ok: false, modelCount: 0, modelIds: [], reason: `HTTP ${response.status}` };
    }
    const json = (await response.json()) as { data?: Array<{ id: string }> };
    if (!json.data || !Array.isArray(json.data) || json.data.length === 0) {
      return { ok: false, modelCount: 0, modelIds: [], reason: 'no models in /models response' };
    }
    return { ok: true, modelCount: json.data.length, modelIds: json.data.map((m) => m.id) };
  } catch (err) {
    return { ok: false, modelCount: 0, modelIds: [], reason: err instanceof Error ? err.message : String(err) };
  }
}

test.describe.serial('electron BYO LLM Settings smoke (live endpoint)', () => {
  test.setTimeout(300_000);

  let app: LaunchedElectronApp | undefined;
  let probeResult: { ok: boolean; modelCount: number; modelIds: string[]; reason?: string } | undefined;
  const tempRoots: string[] = [];

  test.beforeAll(async () => {
    probeResult = await probeEndpointAvailable();
    if (!probeResult.ok) {
      test.skip(
        true,
        `BYO LLM endpoint at ${BYO_BASE_URL} unreachable (${probeResult.reason ?? 'unknown'}). `
          + 'Set CHAMBER_E2E_BYO_LLM_BASE_URL/API_KEY/HEADER_NAME/HEADER_VALUE to override or '
          + 'start your local LLM before running this spec.',
      );
    }

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-byo-live-e2e-'));
    tempRoots.push(root);
    const userData = path.join(root, 'user-data');
    const settingsMindRoot = path.join(root, 'live-settings-hera');
    seedMind(settingsMindRoot, 'Live Settings Hera');
    seedAppConfig(userData, settingsMindRoot, 'live-settings-hera');
    app = await launchElectronApp({
      cdpPort,
      env: { CHAMBER_E2E_USER_DATA: userData },
    });
  });

  test.afterAll(async () => {
    await app?.close();
    for (const root of tempRoots) {
      await removeTempRoot(root);
    }
    await delay(200);
  });

  test('FVT-BYO01: Local & Custom LLM section renders in Settings', async () => {
    const page = await findRendererPage(app?.browser, app?.logs ?? []);
    await waitForApp(page);

    await openSettings(page);
    await expect(page.getByRole('heading', { name: /Local.*Custom LLM/i })).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Enable BYO LLM' })).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByText(/BYO fields are hidden/i)).toBeVisible();
    await expect(page.getByLabel('Endpoint URL')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Test connection/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Apply/i })).toHaveCount(0);
  });

  test('FVT-BYO02: Probe against the real endpoint lists actual models and keeps the model dropdown stable', async () => {
    const page = await findRendererPage(app?.browser, app?.logs ?? []);
    await waitForApp(page);
    await openSettings(page);

    await fillByoSettings(page, BYO_BASE_URL, BYO_API_KEY, BYO_CUSTOM_HEADERS);
    await page.getByRole('button', { name: /Test connection/i }).click();

    await expect(page.getByText(/Found \d+ models?/i)).toBeVisible({ timeout: 30_000 });
    const message = await page.getByText(/Found \d+ models?/i).textContent();
    const match = message?.match(/Found (\d+) model/);
    const found = Number(match?.[1] ?? 0);
    expect(found).toBe(probeResult!.modelCount);

    const preferredModel = preferredChatModel(probeResult!.modelIds);
    await page.getByLabel('Default model').selectOption(preferredModel);
    await expect(page.getByLabel('Default model')).toHaveJSProperty('tagName', 'SELECT');
    await expect(page.getByLabel('Default model')).toHaveValue(preferredModel);
    await expect(page.getByRole('button', { name: /Apply/i })).toBeEnabled();
  });

  test('FVT-BYO03: Apply enables BYO settings; toggle off + Apply disables without restart dialog', async () => {
    const page = await findRendererPage(app?.browser, app?.logs ?? []);
    await waitForApp(page);
    await openSettings(page);

    await fillByoSettings(page, BYO_BASE_URL, BYO_API_KEY, BYO_CUSTOM_HEADERS);
    await page.getByRole('button', { name: /Test connection/i }).click();
    await expect(page.getByText(/Found \d+ models?/i)).toBeVisible({ timeout: 30_000 });
    const preferredModel = preferredChatModel(probeResult!.modelIds);
    await page.getByLabel('Default model').selectOption(preferredModel);

    await page.getByRole('button', { name: /Apply/i }).click();
    await expect(page.getByText(/BYO LLM settings applied\. Refreshed \d+ BYO-selected agent/i)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/Active:/i)).toBeVisible();
    await expect(page.locator('span.font-mono').filter({ hasText: preferredModel }).first()).toBeVisible();
    await expect(page.getByRole('dialog', { name: /Restart all agents/i })).toHaveCount(0);

    await setByoEnabled(page, false);
    await page.getByRole('button', { name: /Apply/i }).click();
    await expect(page.getByText(/BYO LLM disabled\. Refreshed \d+ BYO-selected agent/i)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/Currently disabled/i)).toBeVisible();
    await expect(page.getByRole('dialog', { name: /Restart all agents/i })).toHaveCount(0);
  });

  test('FVT-BYO04: selected BYO model can complete a chat turn through the provided endpoint', async () => {
    let page = await findRendererPage(app?.browser, app?.logs ?? []);
    await waitForApp(page);

    const mind = await getMind(page, 'live-settings-hera');
    expect(mind).toBeDefined();
    const preferredModel = preferredChatModel(probeResult!.modelIds);
    await saveByoConfig(page, {
      enabled: true,
      baseUrl: BYO_BASE_URL,
      providerType: 'openai',
      apiKey: BYO_API_KEY,
      customHeaders: BYO_CUSTOM_HEADERS,
      model: preferredModel,
      wireApi: 'completions',
      maxPromptTokens: 3000,
      maxOutputTokens: 512,
    });
    page = await findRendererPage(app?.browser, app?.logs ?? []);
    await waitForApp(page);

    const nonce = `CHAMBER_BYO_REAL_${Date.now().toString(36)}`;
    const result = await sendDirectChat(
      page,
      mind!.mindId,
      `Reply with exactly this token and no extra words: ${nonce}`,
      modelSelectionKey({ id: preferredModel, provider: 'byo' }) ?? `byo:${encodeURIComponent(preferredModel)}`,
      180_000,
    );

    expect(result.errorMessage).toBe('');
    expect(result.text).toContain(nonce);
  });
});

test.describe.serial('electron BYO LLM provider routing (local relay)', () => {
  test.setTimeout(240_000);

  let app: LaunchedElectronApp | undefined;
  let relay: LocalOpenAiRelay | undefined;
  let root = '';
  let mind: MindContext | undefined;

  test.beforeAll(async () => {
    relay = await startLocalOpenAiRelay();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-byo-relay-e2e-'));
    const mindRoot = path.join(root, 'relay-hera');
    seedMind(mindRoot, 'Relay Hera');
    app = await launchElectronApp({
      cdpPort: localRelayCdpPort,
      env: { CHAMBER_E2E_USER_DATA: path.join(root, 'user-data') },
    });
    const page = await findRendererPage(app.browser, app.logs);
    await waitForApp(page);
    mind = await loadMind(page, mindRoot, 'Relay Hera');
  });

  test.afterAll(async () => {
    await app?.close();
    await relay?.close();
    if (root) await removeTempRoot(root);
  });

  test('FVT-BYO05: BYO-enabled cloud/default turn does not hit BYO relay, explicit BYO selection does', async () => {
    const page = await findRendererPage(app?.browser, app?.logs ?? []);
    await waitForApp(page);
    expect(mind).toBeDefined();
    expect(relay).toBeDefined();

    await saveByoConfig(page, {
      enabled: true,
      baseUrl: relay!.baseUrl,
      providerType: 'openai',
      apiKey: 'not-needed',
      model: localRelayModel,
      wireApi: 'completions',
    });

    const models = await page.evaluate((mindId) => window.electronAPI.chat.listModels(mindId), mind!.mindId);
    const localModel = models.find((model) => model.id === localRelayModel && model.provider === 'byo');
    expect(localModel).toBeTruthy();

    const cloudMindRoot = path.join(root, 'cloud-probe-hera');
    seedMind(cloudMindRoot, 'Cloud Probe Hera');
    const cloudMind = await loadMind(page, cloudMindRoot, 'Cloud Probe Hera');

    relay!.clear();
    await startCloudTurnWithoutWaiting(page, cloudMind.mindId, 'This cloud/default turn must not call the local relay.');
    expect(relay!.chatCompletionCount).toBe(0);

    const result = await sendDirectChat(
      page,
      mind!.mindId,
      'Reply with the local relay sentinel.',
      modelSelectionKeyFromModel(localModel!),
      90_000,
    );
    expect(result.errorMessage).toBe('');
    expect(result.text).toContain(localRelaySentinel);
    expect(relay!.chatCompletionCount).toBeGreaterThan(0);

    const selected = await getMind(page, mind!.mindId);
    expect(selected?.selectedModel).toBe(localRelayModel);
    expect(selected?.selectedModelProvider).toBe('byo');
  });

  test('FVT-BYO06: broken BYO URL fails BYO turns instead of silently falling back', async () => {
    const page = await findRendererPage(app?.browser, app?.logs ?? []);
    await waitForApp(page);
    expect(mind).toBeDefined();

    await saveByoConfig(page, {
      enabled: true,
      baseUrl: 'http://127.0.0.1:9/v1',
      providerType: 'openai',
      apiKey: 'not-needed',
      model: localRelayModel,
      wireApi: 'completions',
    });

    const result = await sendDirectChat(
      page,
      mind!.mindId,
      'This should fail because the BYO endpoint is intentionally broken.',
      modelSelectionKey({ id: localRelayModel, provider: 'byo' }) ?? `byo:${encodeURIComponent(localRelayModel)}`,
      90_000,
    );

    expect(result.errorMessage).not.toBe('');
    expect(result.text).not.toContain(localRelaySentinel);
  });

  test('FVT-BYO07: disabling BYO clears only BYO-selected minds and removes local models from the picker', async () => {
    const page = await findRendererPage(app?.browser, app?.logs ?? []);
    await waitForApp(page);
    expect(mind).toBeDefined();
    expect(relay).toBeDefined();

    await saveByoConfig(page, {
      enabled: true,
      baseUrl: relay!.baseUrl,
      providerType: 'openai',
      apiKey: 'not-needed',
      model: localRelayModel,
      wireApi: 'completions',
    });
    await page.evaluate(
      ({ mindId, model }) => window.electronAPI.mind.setModel(mindId, model),
      {
        mindId: mind!.mindId,
        model: modelSelectionKey({ id: localRelayModel, provider: 'byo' }) ?? `byo:${encodeURIComponent(localRelayModel)}`,
      },
    );

    let selected = await getMind(page, mind!.mindId);
    expect(selected?.selectedModelProvider).toBe('byo');

    await page.evaluate(async () => {
      const result = await window.electronAPI.byoLlm.disable();
      if (!result.success) throw new Error(result.error ?? 'disable failed');
      const restart = await window.electronAPI.byoLlm.restartAgents();
      if (!restart.success) throw new Error(restart.error ?? 'restart failed');
    });

    selected = await getMind(page, mind!.mindId);
    expect(selected?.selectedModel).toBeUndefined();
    expect(selected?.selectedModelProvider).toBeUndefined();

    const models = await page.evaluate((mindId) => window.electronAPI.chat.listModels(mindId), mind!.mindId);
    expect(models.some((model) => model.provider === 'byo')).toBe(false);
  });
});

async function waitForApp(page: Page): Promise<void> {
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

async function openSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
}

async function fillByoSettings(
  page: Page,
  baseUrl: string,
  apiKey: string,
  customHeaders?: Record<string, string>,
): Promise<void> {
  await setByoEnabled(page, true);
  await page.getByLabel('Endpoint URL').fill(baseUrl);
  await page.getByLabel('API key').fill(apiKey);
  if (customHeaders) {
    const headersTextArea = page.getByLabel('Custom headers JSON');
    if (!await headersTextArea.isVisible()) {
      await page.getByText(/Advanced provider settings/i).click();
      await expect(headersTextArea).toBeVisible();
    }
    await headersTextArea.fill(JSON.stringify(customHeaders, null, 2));
  }
}

async function setByoEnabled(page: Page, enabled: boolean): Promise<void> {
  const toggle = page.getByRole('switch', { name: 'Enable BYO LLM' });
  if (await toggle.getAttribute('aria-checked') !== String(enabled)) {
    await toggle.click();
  }
}

function preferredChatModel(modelIds: string[]): string {
  if (BYO_PREFERRED_MODEL && modelIds.includes(BYO_PREFERRED_MODEL)) {
    return BYO_PREFERRED_MODEL;
  }
  return modelIds.find((id) => !/embedding|embed/i.test(id))
    ?? modelIds[0];
}

async function loadMind(page: Page, mindPath: string, name: string): Promise<MindContext> {
  const mind = await page.evaluate(async (pathToMind) => {
    const loaded = await window.electronAPI.mind.add(pathToMind);
    await window.electronAPI.mind.setActive(loaded.mindId);
    return loaded;
  }, mindPath);
  const mindButton = page.getByRole('button', { name }).first();
  await expect(mindButton).toBeVisible();
  await mindButton.click({ force: true });
  await expect(mindButton).toHaveClass(/bg-accent/);
  await expect(page.getByPlaceholder('Message your agent… (paste an image to attach)')).toBeEnabled();
  return mind;
}

async function saveByoConfig(page: Page, config: ByoLlmConfig): Promise<void> {
  await page.evaluate(async (cfg) => {
    const result = await window.electronAPI.byoLlm.save(cfg);
    if (!result.success) throw new Error(result.error ?? 'BYO save failed');
    const restart = await window.electronAPI.byoLlm.restartAgents();
    if (!restart.success) throw new Error(restart.error ?? 'BYO restart failed');
  }, config);
}

async function getMind(page: Page, mindId: string): Promise<MindContext | undefined> {
  return page.evaluate(
    (id) => window.electronAPI.mind.list().then((minds) => minds.find((candidate) => candidate.mindId === id)),
    mindId,
  );
}

async function startCloudTurnWithoutWaiting(page: Page, mindId: string, prompt: string): Promise<void> {
  await page.evaluate(async ({ id, text }) => {
    const messageId = `cloud-probe-${Date.now().toString(36)}`;
    const terminal = new Promise<void>((resolve) => {
      const unsubscribe = window.electronAPI.chat.onEvent((receivedMindId, receivedMessageId, event) => {
        if (receivedMindId !== id || receivedMessageId !== messageId) return;
        if (event.type === 'done' || event.type === 'error' || event.type === 'timeout') {
          unsubscribe();
          resolve();
        }
      });
    });
    const send = window.electronAPI.chat.send(id, text, messageId).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    await window.electronAPI.chat.stop(id, messageId).catch(() => undefined);
    await Promise.race([
      Promise.all([send, terminal]),
      new Promise((resolve) => setTimeout(resolve, 30_000)),
    ]);
  }, { id: mindId, text: prompt });
}

async function sendDirectChat(
  page: Page,
  mindId: string,
  prompt: string,
  model: string,
  timeoutMs: number,
): Promise<{ events: ChatEvent['type'][]; text: string; errorMessage: string }> {
  return page.evaluate(async ({ id, text, selectedModel, waitMs }) => {
    const messageId = `direct-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const events: ChatEvent['type'][] = [];
    const chunks: string[] = [];
    let errorMessage = '';
    const done = new Promise<void>((resolve) => {
      const unsubscribe = window.electronAPI.chat.onEvent((receivedMindId, receivedMessageId, event) => {
        if (receivedMindId !== id || receivedMessageId !== messageId) return;
        events.push(event.type);
        if (event.type === 'chunk') chunks.push(event.content);
        if (event.type === 'message_final') chunks.push(event.content);
        if (event.type === 'error') {
          errorMessage = event.message;
          unsubscribe();
          resolve();
        }
        if (event.type === 'done') {
          unsubscribe();
          resolve();
        }
      });
    });
    const send = window.electronAPI.chat.send(id, text, messageId, selectedModel);
    const timer = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), waitMs));
    const outcome = await Promise.race([Promise.all([send, done]).then(() => 'done' as const), timer]);
    if (outcome === 'timeout') {
      await window.electronAPI.chat.stop(id, messageId).catch(() => undefined);
      errorMessage = errorMessage || `Timed out waiting ${waitMs}ms for chat turn`;
    }
    return { events, text: chunks.join(''), errorMessage };
  }, { id: mindId, text: prompt, selectedModel: model, waitMs: timeoutMs });
}

function seedMind(seedPath: string, mindName: string): void {
  fs.mkdirSync(path.join(seedPath, '.github', 'agents'), { recursive: true });
  fs.mkdirSync(path.join(seedPath, '.working-memory'), { recursive: true });
  fs.writeFileSync(
    path.join(seedPath, 'SOUL.md'),
    [`# ${mindName}`, '', `${mindName} is a deterministic BYO LLM smoke-test mind.`, ''].join('\n'),
  );
  fs.writeFileSync(
    path.join(seedPath, '.github', 'agents', `${mindName.toLowerCase().replaceAll(' ', '-')}.agent.md`),
    [
      '---',
      `name: ${mindName}`,
      'description: Chamber BYO LLM smoke-test persona',
      '---',
      '',
      `# ${mindName} Agent`,
      '',
      'Help validate the BYO LLM Settings flow.',
      '',
    ].join('\n'),
  );
  for (const file of ['memory.md', 'rules.md', 'log.md']) {
    fs.writeFileSync(path.join(seedPath, '.working-memory', file), '');
  }
}

function seedAppConfig(userDataPath: string, mindPath: string, mindId: string): void {
  fs.mkdirSync(userDataPath, { recursive: true });
  fs.writeFileSync(
    path.join(userDataPath, 'config.json'),
    JSON.stringify({
      version: 2,
      minds: [{ id: mindId, path: mindPath }],
      activeMindId: mindId,
      activeLogin: null,
      theme: 'dark',
    }, null, 2),
  );
}

async function removeTempRoot(root: string): Promise<void> {
  try {
    await fs.promises.rm(root, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}

interface RelayRequest {
  method: string;
  pathname: string;
  body: string;
}

class LocalOpenAiRelay {
  private readonly server: http.Server;

  constructor(server: http.Server, readonly baseUrl: string, readonly requests: RelayRequest[]) {
    this.server = server;
  }

  get chatCompletionCount(): number {
    return this.requests.filter((request) => request.pathname.endsWith('/chat/completions')).length;
  }

  clear(): void {
    this.requests.length = 0;
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}

async function startLocalOpenAiRelay(): Promise<LocalOpenAiRelay> {
  const requests: RelayRequest[] = [];
  const server = http.createServer((req, res) => {
    void handleRelayRequest(req, res, requests);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return new LocalOpenAiRelay(server, `http://127.0.0.1:${address.port}/v1`, requests);
}

async function handleRelayRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  requests: RelayRequest[],
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const body = await readBody(req);
  requests.push({ method: req.method ?? 'GET', pathname: url.pathname, body });

  if (req.method === 'GET' && url.pathname.endsWith('/models')) {
    writeJson(res, {
      object: 'list',
      data: [{ id: localRelayModel, object: 'model', created: 0, owned_by: 'chamber-e2e' }],
    });
    return;
  }

  if (req.method === 'POST' && url.pathname.endsWith('/chat/completions')) {
    const parsed = parseJsonObject(body);
    const model = typeof parsed.model === 'string' ? parsed.model : localRelayModel;
    if (parsed.stream === true) {
      writeSseCompletion(res, model);
    } else {
      writeJson(res, {
        id: 'chatcmpl-chamber-e2e',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: localRelaySentinel },
            finish_reason: 'stop',
          },
        ],
      });
    }
    return;
  }

  writeJson(res, { error: { message: `Unhandled relay path ${req.method ?? 'GET'} ${url.pathname}` } }, 404);
}

function writeSseCompletion(res: http.ServerResponse, model: string): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const created = Math.floor(Date.now() / 1000);
  res.write(`data: ${JSON.stringify({
    id: 'chatcmpl-chamber-e2e',
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [{ index: 0, delta: { role: 'assistant', content: localRelaySentinel }, finish_reason: null }],
  })}\n\n`);
  res.write(`data: ${JSON.stringify({
    id: 'chatcmpl-chamber-e2e',
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
  })}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

function writeJson(res: http.ServerResponse, payload: unknown, statusCode = 200): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseJsonObject(body: string): Record<string, unknown> {
  if (!body) return {};
  try {
    const parsed = JSON.parse(body) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}
