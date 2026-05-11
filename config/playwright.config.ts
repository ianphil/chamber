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
        CHAMBER_E2E: '1',
        CHAMBER_E2E_FAKE_CHAT: '1',
        CHAMBER_E2E_FAKE_CHAT_REPLY: 'CHAMBER_BROWSER_LOOPBACK_ACK',
        // Pre-seed three minds so chat + chatroom specs don't need to call
        // mind.add + reload before each test. Paths are opaque labels in
        // fake-chat mode — basename becomes the mind name and ${name}-e2e
        // becomes the mindId.
        CHAMBER_E2E_FAKE_MINDS: 'e2e-monica,e2e-alice,e2e-bob',
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
