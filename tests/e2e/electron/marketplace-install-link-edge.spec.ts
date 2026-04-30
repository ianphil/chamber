import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const internalMarketplaceId = 'github:agency-microsoft/genesis-minds';
const internalMarketplaceRepoUrl = 'https://github.com/agency-microsoft/genesis-minds';
const configPath = path.join(os.homedir(), '.chamber', 'config.json');
const playwrightSnapshotDir = path.resolve(process.cwd(), '.playwright-cli');

test.describe('Edge marketplace install link smoke', () => {
  test.skip(
    process.env.CHAMBER_E2E_EDGE_MARKETPLACE_INSTALL_LINK !== '1',
    'Set CHAMBER_E2E_EDGE_MARKETPLACE_INSTALL_LINK=1 to run the real Edge/chamber:// install-link smoke.'
  );
  test.setTimeout(180_000);

  test('clicks the internal marketplace README badge and waits for Chamber enrollment', async () => {
    expect(process.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN, 'PLAYWRIGHT_MCP_EXTENSION_TOKEN must be loaded from local .env.').toBeTruthy();
    expect(isChamberProtocolRegistered(), 'The chamber:// protocol must be registered by an installed Chamber build.').toBe(true);
    expect(hasCommand('playwright-cli'), 'playwright-cli must be available on PATH for Edge extension-mode automation.').toBe(true);

    const backupPath = backupConfig();
    try {
      runPlaywrightCli(['open', '--extension', '--browser=msedge']);
      runPlaywrightCli(['open', internalMarketplaceRepoUrl]);
      runPlaywrightCli(['snapshot']);
      const badgeRef = findLatestSnapshotRef(/link "Add to Chamber"/);

      console.log('Clicking the internal marketplace Add to Chamber badge in Edge.');
      console.log('Approve the Edge external-protocol prompt and the Chamber add-marketplace confirmation if they appear.');
      runPlaywrightCli(['click', badgeRef]);

      await expect.poll(() => readInternalMarketplaceEnabled(), {
        timeout: 120_000,
        intervals: [1_000, 2_000, 5_000],
        message: `Expected ${internalMarketplaceId} to be persisted and enabled in ${configPath}.`,
      }).toBe(true);
    } finally {
      restoreConfig(backupPath);
    }
  });
});

function runPlaywrightCli(args: string[]): string {
  return execFileSync('playwright-cli', args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function hasCommand(command: string): boolean {
  try {
    execFileSync('powershell', ['-NoProfile', '-Command', `Get-Command ${command} -ErrorAction Stop | Out-Null`], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function isChamberProtocolRegistered(): boolean {
  const script = [
    "$paths = @('HKCU:\\Software\\Classes\\chamber', 'HKLM:\\Software\\Classes\\chamber')",
    'if ($paths | Where-Object { Test-Path $_ }) { exit 0 }',
    'exit 1',
  ].join('; ');
  try {
    execFileSync('powershell', ['-NoProfile', '-Command', script], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function findLatestSnapshotRef(pattern: RegExp): string {
  const snapshots = fs.readdirSync(playwrightSnapshotDir)
    .filter((fileName) => /^page-.*\.yml$/.test(fileName))
    .map((fileName) => path.join(playwrightSnapshotDir, fileName))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);

  for (const snapshotPath of snapshots) {
    const content = fs.readFileSync(snapshotPath, 'utf-8');
    const line = content.split(/\r?\n/).find((candidate) => pattern.test(candidate));
    const match = line?.match(/\[ref=(e\d+)\]/);
    if (match) return match[1];
  }

  throw new Error(`Unable to find a snapshot element matching ${pattern}.`);
}

function readInternalMarketplaceEnabled(): boolean {
  if (!fs.existsSync(configPath)) return false;
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as {
    marketplaceRegistries?: Array<{ id?: string; enabled?: boolean }>;
  };
  return config.marketplaceRegistries?.some((registry) =>
    registry.id === internalMarketplaceId && registry.enabled === true
  ) ?? false;
}

function backupConfig(): string | null {
  if (!fs.existsSync(configPath)) return null;
  const backupPath = `${configPath}.edge-marketplace-smoke-${Date.now()}.bak`;
  fs.copyFileSync(configPath, backupPath);
  console.log(`Backed up Chamber config to ${backupPath}`);
  return backupPath;
}

function restoreConfig(backupPath: string | null): void {
  if (backupPath && fs.existsSync(backupPath)) {
    fs.copyFileSync(backupPath, configPath);
    fs.rmSync(backupPath, { force: true });
    return;
  }

  if (fs.existsSync(configPath) && readInternalMarketplaceEnabled()) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as {
      marketplaceRegistries?: Array<{ id?: string }>;
    };
    config.marketplaceRegistries = config.marketplaceRegistries?.filter((registry) => registry.id !== internalMarketplaceId);
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  }
}
