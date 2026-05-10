import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      external: [
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
