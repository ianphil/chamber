import { defineConfig } from 'vite';

// Vite build config for the voice dictation worker_threads entries. These
// produce engineWorker.js + installerWorker.js next to main.js in .vite/build,
// loaded at runtime via `new Worker(workerPath)` from main.ts. `foundry-local-sdk`
// is left external because it loads native prebuilds at runtime; bundling would
// break the asar.unpack glob in forge.config.ts.
export default defineConfig({
  build: {
    rollupOptions: {
      external: [
        'foundry-local-sdk',
        'node:worker_threads',
        'node:path',
        'node:fs',
        'better-sqlite3',
        'node:sqlite',
        'keytar',
        'sharp',
        '@azure/msal-node-extensions',
        '@azure/msal-node-runtime',
        'chamber-copilot',
      ],
    },
  },
});
