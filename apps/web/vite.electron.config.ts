import { defineConfig, mergeConfig } from 'vite';
import path from 'node:path';
import webConfig from './vite.config';
import { PACKAGED_RENDERER_RELATIVE_DIR } from '../../config/packaged-renderer.cjs';

export default mergeConfig(webConfig, defineConfig({
  build: {
    outDir: path.resolve(__dirname, '../..', PACKAGED_RENDERER_RELATIVE_DIR),
    emptyOutDir: true,
  },
}));
