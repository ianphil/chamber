import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '../tests/e2e',
  outputDir: '../test-results/playwright',
  reporter: [['list']],
  timeout: 180_000,
  expect: {
    timeout: 10_000,
  },
  projects: [
    {
      name: 'web',
      testMatch: /web\/.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://127.0.0.1:4173',
      },
    },
    {
      name: 'electron',
      testMatch: /electron\/.*\.spec\.ts/,
      use: {},
    },
  ],
  webServer: [
    {
      command: 'npm --workspace @chamber/server run build && node ../apps/server/dist/bin.mjs',
      url: 'http://127.0.0.1:33441/api/health',
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: {
        CHAMBER_SERVER_PORT: '33441',
        CHAMBER_SERVER_TOKEN: 'e2e-token',
        CHAMBER_ALLOWED_ORIGIN: 'http://127.0.0.1:4173',
      },
    },
    {
      command: 'npm --workspace @chamber/web run dev -- --port 4173',
      url: 'http://127.0.0.1:4173',
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
