import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  root: path.resolve(__dirname, '..'),
  test: {
    globals: true,
    environment: 'node',
    // INVARIANT: use the `forks` pool, not the default `threads` pool.
    // better-sqlite3 native finalizers race the worker-thread teardown when
    // running on a thread pool; the result is a benign "Worker exited
    // unexpectedly" error after all tests pass, which makes vitest exit 1
    // and silently drops ~25 tests partway through the run. Forks isolate
    // each test file in a real subprocess, so native modules clean up at
    // process exit. Pair with --no-file-parallelism --maxWorkers=1 in the
    // npm script for serial execution.
    pool: 'forks',
    include: [
      'apps/**/*.{test,spec}.{ts,tsx}',
      'packages/**/*.{test,spec}.{ts,tsx}',
      'tests/regression/**/*.{test,spec}.{ts,tsx}',
      'tests/integration/**/*.{test,spec}.{ts,tsx}',
      '.github/extensions/**/*.{test,spec}.mjs',
    ],
    exclude: ['node_modules', 'dist', 'out', '.vite', 'apps/*/dist', 'packages/*/dist'],
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '../apps/web/src'),
    },
  },
});
