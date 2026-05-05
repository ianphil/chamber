#!/usr/bin/env node
// Idempotent Playwright browser installer.
//
// Detects the Chromium headless-shell binary that Playwright resolves at
// runtime and only invokes `playwright install chromium` when it's missing.
// First-time contributors get a one-shot install; subsequent runs are no-ops.
//
// Usage:
//   node scripts/install-playwright-browsers.js
//   npm run smoke:install

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');

function chromiumExecutablePath() {
  try {
    // Lazy-require so a missing dependency surfaces a clearer error than
    // a generic MODULE_NOT_FOUND from spawnSync.
    const { chromium } = require('@playwright/test');
    return chromium.executablePath();
  } catch (error) {
    console.error('[install-playwright-browsers] @playwright/test is not installed. Run `npm install` first.');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function ensureInstalled() {
  const executablePath = chromiumExecutablePath();
  if (executablePath && fs.existsSync(executablePath)) {
    console.log(`[install-playwright-browsers] Chromium already present at ${executablePath}.`);
    return 0;
  }

  console.log('[install-playwright-browsers] Chromium not found — installing…');
  const result = spawnSync('npx', ['playwright', 'install', 'chromium'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.status !== 0) {
    console.error('[install-playwright-browsers] Install failed.');
    return result.status ?? 1;
  }

  console.log('[install-playwright-browsers] Done.');
  return 0;
}

process.exit(ensureInstalled());
