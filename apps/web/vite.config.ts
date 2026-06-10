import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { chamberPluginVirtualModule } from './vite/chamberPluginVirtualModule';

export default defineConfig({
  root: __dirname,
  plugins: [tailwindcss(), chamberPluginVirtualModule()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:33441',
      '/events': {
        target: 'ws://127.0.0.1:33441',
        ws: true,
      },
      '/ws': {
        target: 'ws://127.0.0.1:33441',
        ws: true,
      },
    },
  },
});
