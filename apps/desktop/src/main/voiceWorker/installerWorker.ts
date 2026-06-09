import { parentPort } from 'node:worker_threads';

import { FoundryLocalManager, type IModel } from 'foundry-local-sdk';
import type { VoiceModelStatus, VoiceWorkerRpcRequest } from '@chamber/shared/voice-types';
import {
  isVoiceWorkerRpcRequest,
  postWorkerError,
  postWorkerSuccess,
  type VoiceWorkerPort,
} from './workerProtocol';

interface FoundryInstallerWorkerState {
  manager: FoundryLocalManager | null;
}

const state: FoundryInstallerWorkerState = {
  manager: null,
};

export function bindInstallerWorker(port: VoiceWorkerPort): void {
  const maybeParentPort = port as VoiceWorkerPort & { on?: (event: 'message', listener: (message: unknown) => void) => void };
  maybeParentPort.on?.('message', (message: unknown) => {
    if (!isVoiceWorkerRpcRequest(message)) return;
    void handleInstallerRequest(message, port);
  });
}

export async function handleInstallerRequest(request: VoiceWorkerRpcRequest, port: VoiceWorkerPort): Promise<void> {
  try {
    switch (request.verb) {
      case 'downloadModel': {
        const status = await downloadModel(request.modelId);
        postWorkerSuccess(port, request, { status });
        return;
      }
      case 'installRuntime':
        await installRuntime();
        postWorkerSuccess(port, request);
        return;
      case 'deleteModel': {
        const status = await deleteModel(request.modelId);
        postWorkerSuccess(port, request, { status });
        return;
      }
      case 'refresh': {
        const statuses = await refreshCachedModels();
        postWorkerSuccess(port, request, { statuses });
        return;
      }
      default:
        throw new Error(`Unsupported voice installer worker verb: ${request.verb}`);
    }
  } catch (err) {
    postWorkerError(port, request, err);
  }
}

async function getManager(): Promise<FoundryLocalManager> {
  if (!state.manager) {
    state.manager = await FoundryLocalManager.createAsync({ appName: 'Chamber', logLevel: 'info' });
  }
  if (!state.manager) {
    throw new Error('Foundry Local manager failed to initialize');
  }
  return state.manager;
}

async function downloadModel(modelId: string): Promise<VoiceModelStatus> {
  const model = await getModel(modelId);
  let lastProgress = 0;
  await model.download((progress) => {
    lastProgress = progress;
  });
  void lastProgress;
  return toModelStatus(model, 'ready');
}

async function installRuntime(): Promise<void> {
  const manager = await getManager();
  await manager.downloadAndRegisterEps(() => {
    // Progress reporting is intentionally not surfaced as a multi-response RPC.
    // Cancelling a runtime install is handled by terminating this worker.
  });
}

async function deleteModel(modelId: string): Promise<VoiceModelStatus> {
  const model = await getModel(modelId);
  model.removeFromCache();
  return toModelStatus(model, 'not-downloaded');
}

async function refreshCachedModels(): Promise<VoiceModelStatus[]> {
  const manager = await getManager();
  const cachedModels = await manager.catalog.getCachedModels();
  return cachedModels.map((model) => toModelStatus(model, 'ready'));
}

async function getModel(modelId: string): Promise<IModel> {
  const manager = await getManager();
  return manager.catalog.getModel(modelId);
}

function toModelStatus(model: IModel, status: VoiceModelStatus['status']): VoiceModelStatus {
  return {
    id: model.alias as VoiceModelStatus['id'],
    status,
    ...(typeof model.info.fileSizeMb === 'number' ? { sizeBytes: Math.round(model.info.fileSizeMb * 1024 * 1024) } : {}),
    ...(status === 'ready' ? { downloadedAt: new Date().toISOString() } : {}),
  };
}

if (parentPort) {
  bindInstallerWorker(parentPort);
}
