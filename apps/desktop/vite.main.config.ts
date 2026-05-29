import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      external: [
        'better-sqlite3',
        'node:sqlite',
        'keytar',
        'sharp',
        '@azure/msal-node-extensions',
        '@azure/msal-node-runtime',
        'chamber-copilot',
        'vscode-jsonrpc',
        /^vscode-jsonrpc\//,
      ],
    },
  },
});
