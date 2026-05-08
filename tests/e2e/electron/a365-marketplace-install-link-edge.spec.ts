import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { IdentityLoader } from '@chamber/services';
import type { AppConfig, InstalledTool } from '@chamber/shared/types';
import { findRendererPage, launchElectronApp, type LaunchedElectronApp } from './electronApp';

const internalMarketplaceId = 'github:agency-microsoft/genesis-minds';
const internalMarketplaceRepoUrl = 'https://github.com/agency-microsoft/genesis-minds';
const configPath = path.join(os.homedir(), '.chamber', 'config.json');
const heinzPath = process.env.CHAMBER_E2E_HEINZ_MIND_PATH ?? path.join(os.homedir(), 'agents', 'heinz-doofenshmirtz');
const playwrightSnapshotDir = path.resolve(process.cwd(), '.playwright-cli');
const cdpPort = Number(process.env.CHAMBER_E2E_A365_EDGE_CDP_PORT ?? 9350);
const keepConfig = process.env.CHAMBER_E2E_A365_EDGE_KEEP_CONFIG === '1';
const a365ToolIds = [
  'a365-teams',
  'a365-mail',
  'a365-calendar',
  'a365-copilot365',
  'a365-planner',
  'a365-whois365',
  'a365-word',
  'a365-excel',
  'a365-sales',
];

test.describe('Edge A365 marketplace install-link smoke', () => {
  test.skip(
    process.env.CHAMBER_E2E_A365_EDGE_MARKETPLACE_TOOLS !== '1',
    'Set CHAMBER_E2E_A365_EDGE_MARKETPLACE_TOOLS=1 to run the real Edge/chamber:// A365 tools smoke.',
  );
  test.setTimeout(420_000);

  test('clicks the internal marketplace badge, installs A365 tools, and injects them into Heinz identity', async () => {
    expect(process.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN, 'PLAYWRIGHT_MCP_EXTENSION_TOKEN must be loaded from local .env.').toBeTruthy();
    expect(isChamberProtocolRegistered(), 'The chamber:// protocol must be registered by an installed Chamber build.').toBe(true);
    expect(hasCommand('playwright-cli'), 'playwright-cli must be available on PATH for Edge extension-mode automation.').toBe(true);
    expect(fs.existsSync(heinzPath), `Heinz mind must exist at ${heinzPath}.`).toBe(true);

    const backupPath = backupConfig();
    try {
      prepareConfigForA365Smoke();
      await demoPause('Connecting playwright-cli to the running Edge browser.');
      runPlaywrightCli(['config', '--extension', '--browser=msedge']);
      waitForPlaywrightConnector();
      await demoPause('Opening the internal Genesis marketplace README in Edge.');
      runPlaywrightCli(['open', internalMarketplaceRepoUrl]);
      runPlaywrightCli(['snapshot']);
      const badgeRef = findLatestSnapshotRef(/link "Add to Chamber"/);

      console.log('Clicking the internal marketplace Add to Chamber badge in Edge.');
      console.log('Approve the Edge external-protocol prompt and the Chamber add-marketplace confirmation if they appear.');
      await demoPause('Ready to click the Add to Chamber badge.');
      runPlaywrightCli(['click', badgeRef]);
      await demoPause('Badge clicked; approve any Edge or Chamber prompts now.');

      await expect.poll(() => readInternalMarketplaceEnabled(), {
        timeout: 120_000,
        intervals: [1_000, 2_000, 5_000],
        message: `Expected ${internalMarketplaceId} to be persisted and enabled in ${configPath}.`,
      }).toBe(true);

      await waitFor(() => a365ToolIds.every((id) => readInstalledTools().some((tool) => tool.id === id)), {
        timeoutMs: 300_000,
        intervalMs: 1_000,
        label: 'all A365 installedTools persisted',
      });

      const installedTools = readInstalledTools();
      for (const id of a365ToolIds) {
        const tool = installedTools.find((candidate) => candidate.id === id);
        expect(tool, `${id} should be persisted`).toBeDefined();
        if (!tool) continue;
        expect(tool.install?.type).toBe('github-release-asset');
        if (tool.install?.type !== 'github-release-asset') continue;
        expect(tool.install.owner).toBe('agency-microsoft');
        expect(tool.install.repo).toBe('a365-cli');
        expect(tool.install.tag).toBe('v0.5.0');
        expect(tool.install.sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(fs.existsSync(tool.install.installedPath), `${id} binary should exist at ${tool.install.installedPath}`).toBe(true);
      }

      const identity = new IdentityLoader(() => installedTools).load(heinzPath);
      expect(identity?.systemMessage).toContain('## Tools');
      expect(identity?.systemMessage).toContain('### teams — A365 Teams CLI');
      expect(identity?.systemMessage).toContain('### mail — A365 Mail CLI');
      expect(identity?.systemMessage).toContain('### calendar — A365 Calendar CLI');
      expect(identity?.systemMessage).toContain('### copilot365 — A365 Copilot CLI');
      expect(identity?.systemMessage).toContain('### planner — A365 Planner CLI');
      expect(identity?.systemMessage).toContain('### whois365 — A365 Whois CLI');
      expect(identity?.systemMessage).toContain('### word — A365 Word CLI');
      expect(identity?.systemMessage).toContain('### excel — A365 Excel CLI');
      expect(identity?.systemMessage).toContain('### sales — A365 Sales CLI');

      const answer = await askHeinzAboutTeamsTool();
      expect(answer.errorMessage).toBe('');
      expect(answer.assistantText).toContain('YES_TEAMS_TOOL_AVAILABLE');
    } finally {
      if (keepConfig) {
        console.log(`Keeping Chamber config changes because CHAMBER_E2E_A365_EDGE_KEEP_CONFIG=1. Backup: ${backupPath ?? '(none)'}`);
      } else {
        restoreConfig(backupPath);
      }
    }
  });
});

async function askHeinzAboutTeamsTool(): Promise<{ assistantText: string; errorMessage: string }> {
  let app: LaunchedElectronApp | undefined;
  try {
    app = await launchElectronApp({ cdpPort });
    const page = await findRendererPage(app.browser, app.logs);
    await page.waitForLoadState('domcontentloaded');
    return await page.evaluate(async () => {
      const minds = await window.electronAPI.mind.list();
      const heinz = minds.find((mind) => mind.mindId === 'heinz-doofenshmirtz-295a');
      if (!heinz) throw new Error('Heinz mind was not loaded.');

      await window.electronAPI.chat.newConversation(heinz.mindId);

      const messageId = `a365-edge-teams-tool-smoke-${Date.now()}`;
      let assistantText = '';
      let errorMessage = '';
      let resolveTerminal: () => void = () => undefined;
      const terminal = new Promise<void>((resolve) => {
        resolveTerminal = resolve;
      });
      const unsubscribe = window.electronAPI.chat.onEvent((mindId, receivedMessageId, event) => {
        if (mindId !== heinz.mindId || receivedMessageId !== messageId) return;
        if (event.type === 'chunk' || event.type === 'message_final') {
          assistantText += event.content;
        }
        if (event.type === 'error') {
          errorMessage = event.message;
          resolveTerminal();
        }
        if (event.type === 'done') {
          resolveTerminal();
        }
      });

      try {
        const send = window.electronAPI.chat.send(
          heinz.mindId,
          [
            'Can you see the A365 Teams CLI tool in your available tools?',
            'If the tools section contains a teams command, reply exactly YES_TEAMS_TOOL_AVAILABLE and no other text.',
            'If not, reply exactly NO_TEAMS_TOOL_AVAILABLE and no other text.',
          ].join(' '),
          messageId,
        );
        const timeout = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Timed out waiting for Heinz Teams tool response.')), 180_000);
        });
        await Promise.race([Promise.all([send, terminal]), timeout]);
        return { assistantText, errorMessage };
      } finally {
        unsubscribe();
      }
    });
  } finally {
    await app?.close();
  }
}

async function demoPause(message: string): Promise<void> {
  const delayMs = Number(process.env.CHAMBER_E2E_A365_EDGE_MARKETPLACE_TOOLS_SLOW_MS ?? 0);
  if (!Number.isFinite(delayMs) || delayMs <= 0) return;
  console.log(`[a365-edge-marketplace-smoke] ${message} Pausing ${delayMs}ms for demo.`);
  await delay(delayMs);
}

function runPlaywrightCli(args: string[]): string {
  return execFileSync('powershell', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    `playwright-cli ${args.map(quotePowerShellArg).join(' ')}`,
  ], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function waitForPlaywrightConnector(): void {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const output = runPlaywrightCli(['snapshot']);
    if (output.includes('MCP client') && output.includes('connected')) return;
  }
  throw new Error('Timed out waiting for Playwright MCP Bridge extension connection.');
}

function quotePowerShellArg(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
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

function backupConfig(): string | null {
  if (!fs.existsSync(configPath)) return null;
  const backupPath = `${configPath}.a365-edge-marketplace-smoke-${Date.now()}.bak`;
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

  if (fs.existsSync(configPath)) {
    const config = readConfig();
    config.marketplaceRegistries = config.marketplaceRegistries?.filter((registry) => registry.id !== internalMarketplaceId);
    config.installedTools = config.installedTools?.filter((tool) => !a365ToolIds.includes(tool.id));
    writeConfig(config);
  }
}

function prepareConfigForA365Smoke(): void {
  const config = readConfig();
  config.minds = [
    { id: 'heinz-doofenshmirtz-295a', path: heinzPath },
    ...(config.minds ?? []).filter((mind) => mind.id !== 'heinz-doofenshmirtz-295a'),
  ];
  config.activeMindId = 'heinz-doofenshmirtz-295a';
  config.marketplaceRegistries = (config.marketplaceRegistries ?? []).filter((registry) => registry.id !== internalMarketplaceId);
  config.installedTools = (config.installedTools ?? []).filter((tool) => !a365ToolIds.includes(tool.id));
  writeConfig(config);
}

function readConfig(): AppConfig {
  if (!fs.existsSync(configPath)) {
    return {
      version: 2,
      minds: [],
      activeMindId: null,
      activeLogin: 'ianphil_microsoft',
      theme: 'dark',
    };
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as AppConfig;
}

function writeConfig(config: AppConfig): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

function readInternalMarketplaceEnabled(): boolean {
  const config = readConfig();
  return config.marketplaceRegistries?.some((registry) =>
    registry.id === internalMarketplaceId && registry.enabled === true
  ) ?? false;
}

function readInstalledTools(): InstalledTool[] {
  return readConfig().installedTools ?? [];
}

async function waitFor(
  predicate: () => boolean,
  options: { timeoutMs: number; intervalMs: number; label: string },
): Promise<void> {
  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(options.intervalMs);
  }
  throw new Error(`Timed out waiting for: ${options.label}`);
}
