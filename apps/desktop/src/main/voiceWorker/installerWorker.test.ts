import { beforeEach, describe, expect, it, vi } from 'vitest';

const foundry = vi.hoisted(() => ({
  createAsync: vi.fn(),
}));

vi.mock('foundry-local-sdk', () => ({
  FoundryLocalManager: {
    createAsync: foundry.createAsync,
  },
}));

interface TestPort {
  messages: unknown[];
  postMessage(message: unknown): void;
}

function createPort(): TestPort {
  return {
    messages: [],
    postMessage(message) {
      this.messages.push(message);
    },
  };
}

function createModel() {
  return {
    alias: 'nemotron-speech-streaming-en-0.6b',
    info: { fileSizeMb: 20 },
    download: vi.fn(async (onProgress?: (progress: number) => void) => {
      onProgress?.(50);
      onProgress?.(100);
    }),
    removeFromCache: vi.fn(),
  };
}

async function importWorker() {
  vi.resetModules();
  return import('./installerWorker');
}

describe('installerWorker', () => {
  beforeEach(() => {
    foundry.createAsync.mockReset();
  });

  it('downloads a model through the Foundry catalog with an onProgress callback', async () => {
    const model = createModel();
    const manager = { catalog: { getModel: vi.fn(async () => model) } };
    foundry.createAsync.mockResolvedValue(manager);
    const port = createPort();
    const { handleInstallerRequest } = await importWorker();

    await handleInstallerRequest({
      requestId: 'download-1',
      verb: 'downloadModel',
      modelId: 'nemotron-speech-streaming-en-0.6b',
    }, port);

    expect(foundry.createAsync).toHaveBeenCalledWith({ appName: 'Chamber', logLevel: 'info' });
    expect(manager.catalog.getModel).toHaveBeenCalledWith('nemotron-speech-streaming-en-0.6b');
    expect(model.download).toHaveBeenCalledWith(expect.any(Function));
    expect(port.messages).toEqual([
      {
        requestId: 'download-1',
        verb: 'downloadModel',
        ok: true,
        status: expect.objectContaining({
          id: 'nemotron-speech-streaming-en-0.6b',
          status: 'ready',
          sizeBytes: 20 * 1024 * 1024,
        }),
      },
    ]);
  });

  it('installs the Foundry runtime execution providers with progress callback', async () => {
    const manager = {
      catalog: { getModel: vi.fn() },
      downloadAndRegisterEps: vi.fn(async (onProgress?: (epName: string, percent: number) => void) => {
        onProgress?.('CPUExecutionProvider', 100);
        return { success: true };
      }),
    };
    foundry.createAsync.mockResolvedValue(manager);
    const port = createPort();
    const { handleInstallerRequest } = await importWorker();

    await handleInstallerRequest({ requestId: 'runtime-1', verb: 'installRuntime' }, port);

    expect(manager.downloadAndRegisterEps).toHaveBeenCalledWith(expect.any(Function));
    expect(port.messages).toEqual([{ requestId: 'runtime-1', verb: 'installRuntime', ok: true }]);
  });

  it('deletes a cached model by removing it from the Foundry cache', async () => {
    const model = createModel();
    const manager = { catalog: { getModel: vi.fn(async () => model) } };
    foundry.createAsync.mockResolvedValue(manager);
    const port = createPort();
    const { handleInstallerRequest } = await importWorker();

    await handleInstallerRequest({
      requestId: 'delete-1',
      verb: 'deleteModel',
      modelId: 'nemotron-speech-streaming-en-0.6b',
    }, port);

    expect(model.removeFromCache).toHaveBeenCalledTimes(1);
    expect(port.messages).toEqual([
      {
        requestId: 'delete-1',
        verb: 'deleteModel',
        ok: true,
        status: {
          id: 'nemotron-speech-streaming-en-0.6b',
          status: 'not-downloaded',
          sizeBytes: 20 * 1024 * 1024,
        },
      },
    ]);
  });

  it('returns cached model statuses on refresh', async () => {
    const model = createModel();
    const manager = { catalog: { getCachedModels: vi.fn(async () => [model]) } };
    foundry.createAsync.mockResolvedValue(manager);
    const port = createPort();
    const { handleInstallerRequest } = await importWorker();

    await handleInstallerRequest({ requestId: 'refresh-1', verb: 'refresh' }, port);

    expect(manager.catalog.getCachedModels).toHaveBeenCalledTimes(1);
    expect(port.messages).toEqual([
      {
        requestId: 'refresh-1',
        verb: 'refresh',
        ok: true,
        statuses: [
          expect.objectContaining({
            id: 'nemotron-speech-streaming-en-0.6b',
            status: 'ready',
            sizeBytes: 20 * 1024 * 1024,
          }),
        ],
      },
    ]);
  });
});
