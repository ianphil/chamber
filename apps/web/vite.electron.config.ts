import { defineConfig, mergeConfig } from 'vite';
import path from 'node:path';
import webConfig from './vite.config';

export default mergeConfig(webConfig, defineConfig({
  build: {
    outDir: path.resolve(__dirname, '../../.vite/renderer/main_window'),
    emptyOutDir: true,
  },
}));
