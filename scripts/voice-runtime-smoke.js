const fs = require('node:fs');
const path = require('node:path');
const { Worker } = require('node:worker_threads');

// This smoke closes the validation gap that let the Foundry singleton bug ship:
// unit/UAT tests mocked the worker path, so they never spawned the Vite-produced
// worker_threads bundle that production uses.
const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, '.vite', 'build');
const workerPath = path.join(buildDir, 'voiceWorker.js');
const stubDir = path.join(buildDir, 'node_modules', 'foundry-local-sdk');

async function main() {
  await buildVoiceWorker();
  installFoundryStub();
  const worker = new Worker(workerPath, {
    workerData: { voiceSdkEntry: path.join(stubDir, 'index.mjs') },
  });
  try {
    const messages = [];
    worker.on('message', (message) => {
      messages.push(message);
    });

    worker.postMessage({ requestId: 'download-1', verb: 'downloadModel', modelId: 'nemotron-speech-streaming-en-0.6b' });
    await waitForResponse(messages, 'download-1');
    const progressEvents = messages.filter((message) => message?.type === 'modelProgress');
    if (progressEvents.length < 2) {
      throw new Error(`Expected repeated modelProgress events, received ${progressEvents.length}.`);
    }

    worker.postMessage({ requestId: 'select-1', verb: 'selectModel', modelId: 'nemotron-speech-streaming-en-0.6b' });
    const selectResponse = await waitForResponse(messages, 'select-1');
    if (selectResponse.ok !== true) {
      throw new Error(`selectModel failed: ${selectResponse.error ?? JSON.stringify(selectResponse)}`);
    }

    console.log('Voice runtime smoke passed: bundled voiceWorker.js handled download progress and selectModel.');
  } finally {
    await worker.terminate().catch(() => undefined);
    fs.rmSync(stubDir, { recursive: true, force: true });
  }
}

async function buildVoiceWorker() {
  const { build } = await import('vite');
  await build({
    configFile: path.join(root, 'apps', 'desktop', 'vite.voiceWorker.config.ts'),
    build: {
      outDir: buildDir,
      emptyOutDir: false,
      lib: {
        entry: path.join(root, 'apps', 'desktop', 'src', 'main', 'voiceWorker', 'voiceWorker.ts'),
        formats: ['es'],
        fileName: () => 'voiceWorker.js',
      },
    },
  });
}

function installFoundryStub() {
  fs.rmSync(stubDir, { recursive: true, force: true });
  fs.mkdirSync(stubDir, { recursive: true });
  fs.writeFileSync(
    path.join(stubDir, 'package.json'),
    JSON.stringify({
      name: 'foundry-local-sdk',
      version: '0.0.0-smoke',
      type: 'module',
      exports: {
        import: './index.mjs',
        require: './index.cjs',
      },
    }, null, 2),
  );
  fs.writeFileSync(path.join(stubDir, 'index.mjs'), foundryStubSource('esm'));
  fs.writeFileSync(path.join(stubDir, 'index.cjs'), foundryStubSource('cjs'));
}

function foundryStubSource(format) {
  const source = `
let manager = null;

function createModel(modelId) {
  return {
    id: modelId,
    alias: modelId,
    info: {
      name: modelId,
      alias: modelId,
      sizeInBytes: 123456,
      task: 'automatic-speech-recognition',
    },
    isCached: true,
    async load() {},
    async download(onProgress) {
      onProgress?.(10);
      onProgress?.(100);
    },
    removeFromCache() {},
    createAudioClient() {
      return {
        createLiveTranscriptionSession() {
          return {
            settings: {},
            async start() {},
            async append() {},
            async stop() {},
            async dispose() {},
            async *getStream() {},
          };
        },
      };
    },
  };
}

class FoundryLocalManager {
  static async createAsync(config) {
    if (!manager) manager = new FoundryLocalManager(config);
    return manager;
  }

  constructor(config) {
    this.config = config;
    this.catalog = {
      getModel: async (modelId) => createModel(modelId),
      getCachedModels: async () => [createModel('nemotron-speech-streaming-en-0.6b')],
    };
  }

  async downloadAndRegisterEps(onProgress) {
    onProgress?.('CPUExecutionProvider', 100);
    return { success: true, status: 'ok', registeredEps: [], failedEps: [] };
  }
}
`;
  if (format === 'esm') return `${source}\nexport { FoundryLocalManager };\n`;
  return `${source}\nmodule.exports = { FoundryLocalManager };\n`;
}

function waitForResponse(messages, requestId) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const interval = setInterval(() => {
      const message = messages.find((candidate) => candidate?.requestId === requestId);
      if (message) {
        clearInterval(interval);
        resolve(message);
        return;
      }
      if (Date.now() - started > 10_000) {
        clearInterval(interval);
        reject(new Error(`Timed out waiting for voice worker response ${requestId}. Messages: ${JSON.stringify(messages)}`));
      }
    }, 25);
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
