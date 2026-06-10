import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { VOICE_DICTATION_MODEL_ID, type VoiceDictationConfig, type VoiceModelStatus, type VoicePermissionState } from '@chamber/shared/voice-types';
import type { ChatImageAttachment, MindContext } from '@chamber/shared/types';
import { findRendererPage, launchElectronApp, type LaunchedElectronApp } from './electronApp';

const cdpPort = Number(process.env.CHAMBER_E2E_VOICE_CDP_PORT ?? 9351);
const mindName = 'Voice Smoke Hera';
const mindId = 'voice-smoke-hera';
const sentinelTranscript = 'hello chamber voice dictation';
const defaultVoiceConfig: VoiceDictationConfig = {
  enabled: true,
  inputDeviceId: null,
  shortcut: 'Alt+Shift+V',
  pushToTalk: true,
  model: { id: VOICE_DICTATION_MODEL_ID },
};
const readyModelStatus: VoiceModelStatus = {
  id: VOICE_DICTATION_MODEL_ID,
  status: 'ready',
  sizeBytes: 512 * 1024 * 1024,
  downloadedAt: '2026-06-09T00:00:00.000Z',
};
const notDownloadedModelStatus: VoiceModelStatus = {
  id: VOICE_DICTATION_MODEL_ID,
  status: 'not-downloaded',
};

test.describe.serial('electron voice dictation UAT smoke', () => {
  test.setTimeout(240_000);

  let app: LaunchedElectronApp | undefined;
  let page: Page;
  let root = '';

  test.beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-voice-e2e-'));
    const userData = path.join(root, 'user-data');
    const mindRoot = path.join(root, mindId);
    seedMind(mindRoot, mindName);
    seedAppConfig(userData, mindRoot, mindId);

    app = await launchElectronApp({
      cdpPort,
      env: {
        CHAMBER_E2E_USER_DATA: userData,
        CHAMBER_E2E_PREVIEW_FEATURES: '1',
        CHAMBER_E2E_VOICE_FAKE: '1',
      },
    });
    page = await findRendererPage(app.browser, app.logs);
    await waitForApp(page);
    await installBrowserMediaStubs(page);
    await expect(page.getByRole('button', { name: mindName }).first()).toBeVisible({ timeout: 60_000 });
    await setVoicePermission(page, 'granted');
    await saveVoiceConfig(page, defaultVoiceConfig);
    await setVoiceModelStatus(page, readyModelStatus);
  });

  test.afterEach(async () => {
    await app?.close();
    app = undefined;
    if (root) await removeTempRoot(root);
    root = '';
    await delay(200);
  });

  test('settings-section-visible', async () => {
    await openSettings(page);

    const section = voiceSettingsSection(page);
    await expect(section.getByRole('heading', { name: 'Voice dictation' })).toBeVisible();
    await expect(section.getByTestId('voice-dictation-settings-row')).toHaveCount(6);
    for (const rowTitle of [
      'Input device',
      'Microphone permissions',
      'Test mic',
      'Shortcut',
      'Push-to-talk',
      'Transcription model',
    ]) {
      await expect(section.getByText(rowTitle, { exact: true }).first()).toBeVisible();
    }
  });

  test('test-mic-success', async () => {
    await openSettings(page);

    await page.getByRole('button', { name: 'Test mic' }).click();

    await expect(page.getByRole('status').filter({ hasText: /Microphone test passed/i })).toContainText(sentinelTranscript);
  });

  test('test-mic-denied', async () => {
    await setVoicePermission(page, 'denied');
    await openSettings(page);

    await page.getByRole('button', { name: 'Test mic' }).click();

    await expect(page.getByRole('alert')).toContainText(/microphone permission is denied/i);
    await expect(page.getByRole('button', { name: 'Open preferences' })).toBeVisible();
  });

  test('chat-mic-inserts-sentinel', async () => {
    await activateMind(page);
    const textarea = chatTextarea(page);
    await textarea.click();

    await startDictationFromMicButton(page);
    await emitTranscript(page);

    await expect(textarea).toHaveValue(new RegExp(`^${escapeRegex(sentinelTranscript)}\\s?$`));
  });

  test('review-before-send', async () => {
    await activateMind(page);
    const textarea = chatTextarea(page);
    const sent = await installChatSendSpy(page);
    await textarea.click();

    await startDictationFromMicButton(page);
    await emitTranscript(page);
    await expect(textarea).toHaveValue(new RegExp(escapeRegex(sentinelTranscript)));

    const edited = 'edited voice dictation review';
    await textarea.fill(edited);
    await page.getByRole('button', { name: 'Send message' }).click();

    await expect(page.getByText(edited, { exact: true })).toBeVisible();
    await expect(page.getByText(sentinelTranscript, { exact: true })).toHaveCount(0);
    await expect.poll(() => sent.messages()).toEqual([edited]);
    expect(await sent.messages()).not.toContain(sentinelTranscript);
  });

  test('draft-preserved', async () => {
    await activateMind(page);
    const textarea = chatTextarea(page);
    await textarea.fill('Hi: ');
    await textarea.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(el.value.length, el.value.length));

    await startDictationFromMicButton(page);
    await emitTranscript(page);

    await expect(textarea).toHaveValue(`Hi: ${sentinelTranscript} `);
  });

  test('enter-still-submits', async () => {
    await activateMind(page);
    const textarea = chatTextarea(page);
    const sent = await installChatSendSpy(page);
    await textarea.click();

    await startDictationFromMicButton(page);
    await emitTranscript(page);
    await expect(textarea).toHaveValue(new RegExp(escapeRegex(sentinelTranscript)));
    await textarea.press('Enter');

    await expect(page.getByText(sentinelTranscript, { exact: true })).toBeVisible();
    await expect.poll(() => sent.messages()).toEqual([sentinelTranscript]);
  });

  test('escape-during-stream-stops', async () => {
    test.fixme(
      true,
      'Current visible UI has no voice Escape-to-cancel behavior: Escape only stops an active chat response stream in ChatInput.',
    );
  });

  test('push-to-talk-hold', async () => {
    await activateMind(page);
    await chatTextarea(page).click();
    const before = await getVoiceSessionState(page);

    await page.keyboard.down('Alt');
    await page.keyboard.down('Shift');
    await page.keyboard.down('V');
    await expect.poll(async () => (await getVoiceSessionState(page)).activeSessionId).not.toBeNull();
    await emitTranscript(page);
    await page.keyboard.up('V');
    await page.keyboard.up('Shift');
    await page.keyboard.up('Alt');

    await expect(chatTextarea(page)).toHaveValue(new RegExp(escapeRegex(sentinelTranscript)));
    await expect.poll(async () => (await getVoiceSessionState(page)).startedCount).toBe(before.startedCount + 1);
    await expect.poll(async () => (await getVoiceSessionState(page)).endedCount).toBe(before.endedCount + 1);
  });

  test('shortcut-suppressed-in-ime', async () => {
    await activateMind(page, { expectMicEnabled: false });
    const textarea = chatTextarea(page);
    await textarea.click();
    const before = await getVoiceSessionState(page);

    await textarea.dispatchEvent('compositionstart');
    await page.evaluate(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'V',
        code: 'KeyV',
        altKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
        isComposing: true,
      }));
    });

    await delay(100);
    expect(await getVoiceSessionState(page)).toEqual(before);
  });

  test('model-not-downloaded-cta', async () => {
    await setVoiceModelStatus(page, notDownloadedModelStatus);
    await activateMind(page);

    const mic = page.getByRole('button', { name: 'Dictate message' });
    await expect(mic).toBeVisible();
    await expect(mic).toBeDisabled();
    await expect(mic).toHaveAttribute('title', 'Download the dictation model in Settings → Voice dictation');
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
  await expect.poll(async () => {
    try {
      return await page.evaluate(() => typeof window.electronAPI?.e2e?.voice?.emitTranscript);
    } catch {
      return 'unavailable';
    }
  }, { timeout: 30_000 }).toBe('function');
}

async function installBrowserMediaStubs(page: Page): Promise<void> {
  await page.evaluate(() => {
    const fakeTrack = { stop: () => undefined };
    const fakeStream = { getTracks: () => [fakeTrack] };
    const fakeMediaDevices = {
      getUserMedia: async () => fakeStream,
      enumerateDevices: async () => [{
        deviceId: 'e2e-fake-microphone',
        groupId: 'e2e',
        kind: 'audioinput',
        label: 'E2E Fake Microphone',
        toJSON: () => ({
          deviceId: 'e2e-fake-microphone',
          groupId: 'e2e',
          kind: 'audioinput',
          label: 'E2E Fake Microphone',
        }),
      }],
    };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: fakeMediaDevices,
    });

    const node = () => ({
      connect: () => undefined,
      disconnect: () => undefined,
    });
    class FakeAudioContext {
      readonly audioWorklet = { addModule: async () => undefined };
      readonly destination = {};
      readonly sampleRate = 48_000;
      createMediaStreamSource() { return node(); }
      createGain() { return { ...node(), gain: { value: 0 } }; }
      close() { return Promise.resolve(); }
    }
    class FakeAudioWorkletNode {
      readonly port = { onmessage: null };
      connect() { return undefined; }
      disconnect() { return undefined; }
    }
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: FakeAudioContext });
    Object.defineProperty(window, 'AudioWorkletNode', { configurable: true, value: FakeAudioWorkletNode });
  });
}

async function openSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
}

function voiceSettingsSection(page: Page) {
  return page.locator('section').filter({ has: page.getByRole('heading', { name: 'Voice dictation' }) });
}

async function activateMind(page: Page, options: { expectMicEnabled?: boolean } = {}): Promise<MindContext> {
  const mind = await page.evaluate(async ({ id, name }) => {
    const minds = await window.electronAPI.mind.list();
    const existing = minds.find((candidate) => candidate.mindId === id || candidate.identity.name === name);
    if (!existing) throw new Error(`Seeded mind ${name} was not loaded`);
    await window.electronAPI.mind.setActive(existing.mindId);
    return existing;
  }, { id: mindId, name: mindName });
  const mindButton = page.getByRole('button', { name: mindName }).first();
  await expect(mindButton).toBeVisible();
  await mindButton.click({ force: true });
  await expect(chatTextarea(page)).toBeEnabled();
  const mic = page.getByRole('button', { name: 'Dictate message' });
  await expect(mic).toBeVisible();
  if (options.expectMicEnabled !== false) {
    await expect(mic).toBeEnabled();
  }
  return mind;
}

function chatTextarea(page: Page) {
  return page.getByPlaceholder('Message your agent… (paste an image to attach)');
}

async function startDictationFromMicButton(page: Page): Promise<void> {
  const mic = page.getByRole('button', { name: 'Dictate message' });
  await expect(mic).toBeEnabled();
  await mic.click();
  await expect(mic).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await getVoiceSessionState(page)).activeSessionId).not.toBeNull();
}

async function emitTranscript(page: Page, text = sentinelTranscript): Promise<void> {
  await page.evaluate(async (transcript) => {
    await window.electronAPI.e2e?.voice?.emitTranscript({ type: 'final', text: transcript });
  }, text);
}

async function setVoicePermission(page: Page, state: VoicePermissionState | null): Promise<void> {
  await page.evaluate(async (nextState) => {
    await window.electronAPI.e2e?.voice?.setPermissionState(nextState);
  }, state);
}

async function setVoiceModelStatus(page: Page, status: VoiceModelStatus | null): Promise<void> {
  await page.evaluate(async (nextStatus) => {
    await window.electronAPI.e2e?.voice?.setModelStatus(nextStatus);
  }, status);
}

async function saveVoiceConfig(page: Page, config: VoiceDictationConfig): Promise<void> {
  await page.evaluate(async (nextConfig) => {
    await window.electronAPI.voice.saveConfig(nextConfig);
  }, config);
}

async function getVoiceSessionState(page: Page): Promise<{ activeSessionId: string | null; startedCount: number; endedCount: number }> {
  return page.evaluate(async () => {
    const state = await window.electronAPI.e2e?.voice?.getSessionState();
    if (!state) throw new Error('Voice e2e session state helper is unavailable');
    return state;
  });
}

async function installChatSendSpy(page: Page): Promise<{ messages: () => Promise<string[]> }> {
  await page.evaluate(() => {
    const api = window.electronAPI;
    const captured: string[] = [];
    const originalList = api.conversationHistory.list.bind(api.conversationHistory);
    const replacement = async (
      _mindId: string,
      message: string,
      _messageId: string,
      _model?: string,
      _attachments?: ChatImageAttachment[],
    ) => {
      void _messageId;
      void _model;
      void _attachments;
      captured.push(message);
    };

    // contextBridge freezes the bridged surface, so we cannot redefine
    // `api.chat.send` directly. Shadow `electronAPI.chat` on `window` with a
    // mutable copy that proxies the original except for `send`.
    const mutableChat = { ...api.chat, send: replacement };
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      writable: true,
      value: { ...api, chat: mutableChat },
    });

    if (window.electronAPI.chat.send !== replacement) {
      throw new Error('Unable to install e2e chat.send spy');
    }
    window.electronAPI.conversationHistory.list = async (mindId: string) => {
      try {
        return await originalList(mindId);
      } catch {
        return [];
      }
    };
    (window as unknown as { __voiceSmokeSentMessages: string[] }).__voiceSmokeSentMessages = captured;
  });

  return {
    messages: () => page.evaluate(() => (window as unknown as { __voiceSmokeSentMessages?: string[] }).__voiceSmokeSentMessages ?? []),
  };
}

function seedMind(seedPath: string, name: string): void {
  fs.mkdirSync(path.join(seedPath, '.github', 'agents'), { recursive: true });
  fs.mkdirSync(path.join(seedPath, '.working-memory'), { recursive: true });
  fs.writeFileSync(
    path.join(seedPath, 'SOUL.md'),
    [`# ${name}`, '', `${name} is a deterministic voice dictation smoke-test mind.`, ''].join('\n'),
  );
  fs.writeFileSync(
    path.join(seedPath, '.github', 'agents', `${name.toLowerCase().replaceAll(' ', '-')}.agent.md`),
    [
      '---',
      `name: ${name}`,
      'description: Chamber voice dictation smoke-test persona',
      '---',
      '',
      `# ${name} Agent`,
      '',
      'Help validate the voice dictation UI flow.',
      '',
    ].join('\n'),
  );
  for (const file of ['memory.md', 'rules.md', 'log.md']) {
    fs.writeFileSync(path.join(seedPath, '.working-memory', file), '');
  }
}

function seedAppConfig(userDataPath: string, mindPath: string, id: string): void {
  fs.mkdirSync(userDataPath, { recursive: true });
  fs.writeFileSync(
    path.join(userDataPath, 'config.json'),
    JSON.stringify({
      version: 2,
      minds: [{ id, path: mindPath }],
      activeMindId: id,
      activeLogin: null,
      theme: 'dark',
    }, null, 2),
  );
}

async function removeTempRoot(rootPath: string): Promise<void> {
  try {
    await fs.promises.rm(rootPath, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
