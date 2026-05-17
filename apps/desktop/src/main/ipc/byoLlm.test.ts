import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as http from 'node:http';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn().mockReturnValue([]) },
}));

import { ipcMain, BrowserWindow } from 'electron';
import { setupByoLlmIPC, probeEndpoint } from './byoLlm';
import type { ByoLlmStore, MindManager } from '@chamber/services';
import { IPC } from '@chamber/shared';
import type { ByoLlmConfig } from '@chamber/shared/types';

function createFakeStore(): ByoLlmStore {
  return {
    load: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
    getFilePath: vi.fn().mockReturnValue('/tmp/byo-llm.json'),
  } as unknown as ByoLlmStore;
}

function createFakeMindManager(): MindManager {
  return {
    restartAllMindsForByoChange: vi.fn().mockResolvedValue({ restartedCount: 2 }),
  } as unknown as MindManager;
}

const validConfig: ByoLlmConfig = {
  enabled: true,
  baseUrl: 'https://example.com/v1',
  apiKey: 'lm-studio',
  bearerToken: 'secret-token',
  customHeaders: { 'X-Secret': 'header-secret' },
  model: 'gemma-4-e4b',
};

const redactedConfig: ByoLlmConfig = {
  ...validConfig,
  apiKey: '********',
  bearerToken: '********',
  customHeaders: { 'X-Secret': '********' },
};

describe('setupByoLlmIPC', () => {
  beforeEach(() => {
    vi.mocked(ipcMain.handle).mockClear();
  });

  it('BVT-IPC01: registers all five byoLlm handlers', () => {
    setupByoLlmIPC(createFakeStore(), createFakeMindManager());
    const channels = vi.mocked(ipcMain.handle).mock.calls.map((c) => c[0]);
    expect(channels).toContain(IPC.BYO_LLM.GET);
    expect(channels).toContain(IPC.BYO_LLM.SAVE);
    expect(channels).toContain(IPC.BYO_LLM.DISABLE);
    expect(channels).toContain(IPC.BYO_LLM.PROBE);
    expect(channels).toContain(IPC.BYO_LLM.RESTART_AGENTS);
  });

  it('BVT-IPC02: byoLlm:get returns a renderer-safe redacted config', async () => {
    const store = createFakeStore();
    (store.load as ReturnType<typeof vi.fn>).mockResolvedValue(validConfig);
    setupByoLlmIPC(store, createFakeMindManager());

    const handler = vi.mocked(ipcMain.handle).mock.calls.find((c) => c[0] === IPC.BYO_LLM.GET);
    await expect(handler![1]({} as never, ...([] as unknown[]))).resolves.toEqual(redactedConfig);
  });

  it('BVT-IPC03: byoLlm:save persists, fires onConfigChanged, and broadcasts redacted config', async () => {
    const store = createFakeStore();
    (store.load as ReturnType<typeof vi.fn>).mockResolvedValue(validConfig);
    const mockSend = vi.fn();
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([{ webContents: { send: mockSend } }] as never);
    const onConfigChanged = vi.fn();
    setupByoLlmIPC(store, createFakeMindManager(), { onConfigChanged });

    const handler = vi.mocked(ipcMain.handle).mock.calls.find((c) => c[0] === IPC.BYO_LLM.SAVE);
    const result = await handler![1]({} as never, validConfig);

    expect(result).toEqual({ success: true });
    expect(store.save).toHaveBeenCalledWith(validConfig);
    expect(onConfigChanged).toHaveBeenCalledWith(validConfig);
    expect(mockSend).toHaveBeenCalledWith(IPC.BYO_LLM.CHANGED, redactedConfig);
  });

  it('BVT-IPC03b: byoLlm:save preserves masked secrets from the existing keychain config', async () => {
    const store = createFakeStore();
    (store.load as ReturnType<typeof vi.fn>).mockResolvedValue(validConfig);
    setupByoLlmIPC(store, createFakeMindManager());

    const handler = vi.mocked(ipcMain.handle).mock.calls.find((c) => c[0] === IPC.BYO_LLM.SAVE);
    const result = await handler![1]({} as never, { ...redactedConfig, model: 'updated-model' });

    expect(result).toEqual({ success: true });
    expect(store.save).toHaveBeenCalledWith({
      ...validConfig,
      model: 'updated-model',
    });
  });

  it('BVT-IPC04: byoLlm:save rejects enabled config without baseUrl', async () => {
    setupByoLlmIPC(createFakeStore(), createFakeMindManager());
    const handler = vi.mocked(ipcMain.handle).mock.calls.find((c) => c[0] === IPC.BYO_LLM.SAVE);
    const result = await handler![1]({} as never, { enabled: true, baseUrl: '' } as ByoLlmConfig);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Base URL/);
  });

  it('BVT-IPC04b: byoLlm:save rejects enabled config without default model', async () => {
    setupByoLlmIPC(createFakeStore(), createFakeMindManager());
    const handler = vi.mocked(ipcMain.handle).mock.calls.find((c) => c[0] === IPC.BYO_LLM.SAVE);
    const result = await handler![1]({} as never, { enabled: true, baseUrl: 'https://example.com/v1', model: '' } as ByoLlmConfig);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Default model/);
  });

  it('BVT-IPC05: byoLlm:disable clears store, fires onConfigChanged(null), broadcasts null', async () => {
    const store = createFakeStore();
    const mockSend = vi.fn();
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([{ webContents: { send: mockSend } }] as never);
    const onConfigChanged = vi.fn();
    setupByoLlmIPC(store, createFakeMindManager(), { onConfigChanged });

    const handler = vi.mocked(ipcMain.handle).mock.calls.find((c) => c[0] === IPC.BYO_LLM.DISABLE);
    const result = await handler![1]({} as never, ...([] as unknown[]));

    expect(result).toEqual({ success: true });
    expect(store.clear).toHaveBeenCalled();
    expect(onConfigChanged).toHaveBeenCalledWith(null);
    expect(mockSend).toHaveBeenCalledWith(IPC.BYO_LLM.CHANGED, null);
  });

  it('BVT-IPC06: byoLlm:restartAgents delegates without forcing all minds onto BYO default', async () => {
    const mindMgr = createFakeMindManager();
    const store = createFakeStore();
    (store.load as ReturnType<typeof vi.fn>).mockResolvedValue(validConfig);
    setupByoLlmIPC(store, mindMgr);
    const handler = vi.mocked(ipcMain.handle).mock.calls.find((c) => c[0] === IPC.BYO_LLM.RESTART_AGENTS);
    const result = await handler![1]({} as never, ...([] as unknown[]));
    expect(result).toEqual({ success: true, restartedCount: 2 });
    expect(mindMgr.restartAllMindsForByoChange).toHaveBeenCalledWith(undefined);
  });

  it('BVT-IPC07: byoLlm:probe rejects empty baseUrl', async () => {
    setupByoLlmIPC(createFakeStore(), createFakeMindManager());
    const handler = vi.mocked(ipcMain.handle).mock.calls.find((c) => c[0] === IPC.BYO_LLM.PROBE);
    const result = await handler![1]({} as never, { enabled: true, baseUrl: '' } as ByoLlmConfig);
    expect(result.ok).toBe(false);
  });
});

describe('probeEndpoint (live HTTP, mocked)', () => {
  it('BVT-IPC08: returns ok:false when probe URL is unreachable', async () => {
    // Pick a port unlikely to be listening
    const result = await probeEndpoint({
      enabled: true,
      baseUrl: 'http://127.0.0.1:1/v1',
    });
    expect(result.ok).toBe(false);
  }, 30_000);

  it('BVT-IPC09: redacts API, bearer, and custom-header secrets from HTTP error bodies', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(401, { 'Content-Type': 'text/plain' });
      res.end('api-secret bearer-secret header-secret');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to bind local probe test server');
    }

    try {
      const result = await probeEndpoint({
        enabled: true,
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        apiKey: 'api-secret',
        bearerToken: 'bearer-secret',
        customHeaders: { 'X-Secret': 'header-secret' },
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).not.toContain('api-secret');
        expect(result.error).not.toContain('bearer-secret');
        expect(result.error).not.toContain('header-secret');
        expect(result.error).toContain('<redacted>');
      }
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  });

  it('BVT-IPC10: rejects 3xx redirect responses without following them (SSRF defense-in-depth)', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' });
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to bind local probe test server');
    }

    try {
      const result = await probeEndpoint({
        enabled: true,
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(302);
        expect(result.error).toMatch(/redirect/i);
        expect(result.error).toMatch(/not followed/i);
        expect(result.error).toContain('169.254.169.254');
      }
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  });
});
