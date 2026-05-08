import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AppConfig, InstalledTool } from '@chamber/shared/types';
import { ToolsService } from './ToolsService';
import { MarketplaceToolCatalog } from './MarketplaceToolCatalog';
import { ToolInstaller, type CommandRunner, type CommandResult, type ReleaseAssetDownloader } from './ToolInstaller';
import type { ToolMarketplaceSource } from './toolTypes';

class FakeRegistryClient {
  manifests = new Map<string, unknown>();
  async fetchTree(): Promise<never[]> { return []; }
  async fetchJsonContent(_owner: string, _repo: string, filePath: string): Promise<unknown> {
    return this.manifests.get(filePath) ?? {};
  }
}

class FakeRunner implements CommandRunner {
  responses = new Map<string, CommandResult>();
  async run(command: string, args: string[]): Promise<CommandResult> {
    const key = `${command} ${args.join(' ')}`;
    return this.responses.get(key) ?? { exitCode: 0, stdout: '', stderr: '' };
  }
}

class FakeReleaseAssetDownloader implements ReleaseAssetDownloader {
  bytes = Buffer.from('a365 binary');
  async downloadAsset(request: { assetName: string }): Promise<{ assetName: string; bytes: Buffer }> {
    return { assetName: request.assetName, bytes: this.bytes };
  }
}

class FakeConfigStore {
  config: AppConfig = {
    version: 2,
    minds: [],
    activeMindId: null,
    activeLogin: null,
    theme: 'dark',
  };
  load(): AppConfig { return JSON.parse(JSON.stringify(this.config)); }
  save(next: AppConfig): void { this.config = next; }
}

const SOURCE: ToolMarketplaceSource = {
  id: 'github:ianphil/genesis-minds',
  label: 'Public Genesis Minds',
  url: 'https://github.com/ianphil/genesis-minds',
  owner: 'ianphil',
  repo: 'genesis-minds',
  ref: 'master',
  plugin: 'genesis-minds',
  enabled: true,
};

const TOOL_ENTRY = {
  id: 'workiq',
  displayName: 'Microsoft Work IQ',
  description: 'Query M365 data.',
  install: { type: 'npm-global', package: '@microsoft/workiq', version: 'latest' },
  bin: 'workiq',
  help: 'workiq ask --help',
  agentInstructions: 'Use workiq ask.',
};

function setupTools(client: FakeRegistryClient, entries: unknown[] = [TOOL_ENTRY]): void {
  client.manifests.set('plugins/genesis-minds/plugin.json', { tools: entries });
}

describe('ToolsService', () => {
  let client: FakeRegistryClient;
  let runner: FakeRunner;
  let store: FakeConfigStore;
  let svc: ToolsService;
  const tempDirs: string[] = [];

  beforeEach(() => {
    client = new FakeRegistryClient();
    runner = new FakeRunner();
    store = new FakeConfigStore();
    svc = new ToolsService(
      new MarketplaceToolCatalog(client, [SOURCE]),
      new ToolInstaller(runner),
      store,
    );
  });

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('lists tools as available when not installed', async () => {
    setupTools(client);
    const list = await svc.list();
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe('available');
    expect(list[0].installedVersion).toBeUndefined();
  });

  it('lists tools as installed when present in config', async () => {
    setupTools(client);
    store.config.installedTools = [installedRecord()];
    const list = await svc.list();
    expect(list[0].status).toBe('installed');
    expect(list[0].installedVersion).toBe('latest');
  });

  it('install persists the InstalledTool and rejects unknown ids', async () => {
    setupTools(client);
    const ok = await svc.install('workiq');
    expect(ok.success).toBe(true);
    expect(store.config.installedTools).toHaveLength(1);
    expect(store.config.installedTools?.[0].id).toBe('workiq');

    const missing = await svc.install('nope');
    expect(missing).toEqual({ success: false, error: 'Tool not found in marketplace: nope' });
  });

  it('install surfaces npm errors without persisting', async () => {
    setupTools(client);
    runner.responses.set('npm install -g @microsoft/workiq@latest', { exitCode: 1, stdout: '', stderr: 'EACCES' });
    const result = await svc.install('workiq');
    expect(result.success).toBe(false);
    expect(store.config.installedTools ?? []).toHaveLength(0);
  });

  it('uninstall removes the record and rejects unknown ids', async () => {
    store.config.installedTools = [installedRecord()];
    const ok = await svc.uninstall('workiq');
    expect(ok.success).toBe(true);
    expect(store.config.installedTools).toHaveLength(0);

    const missing = await svc.uninstall('nope');
    expect(missing.success).toBe(false);
  });

  it('reconcile installs only new tools and continues past per-tool errors', async () => {
    setupTools(client, [
      TOOL_ENTRY,
      { ...TOOL_ENTRY, id: 'broken', bin: 'broken', install: { type: 'npm-global', package: 'broken-pkg', version: '1.0.0' } },
    ]);
    runner.responses.set('npm install -g broken-pkg@1.0.0', { exitCode: 1, stdout: '', stderr: 'boom' });

    const outcome = await svc.reconcile();
    expect(outcome.installed.map((t) => t.id)).toEqual(['workiq']);
    expect(outcome.errors.map((e) => e.toolId)).toEqual(['broken']);
    expect(store.config.installedTools).toHaveLength(1);

    const second = await svc.reconcile();
    expect(second.installed).toHaveLength(0);
    expect(second.errors.map((e) => e.toolId)).toEqual(['broken']);
  });

  it('reconcile persists GitHub release asset tools so IdentityLoader can advertise them offline', async () => {
    const downloader = new FakeReleaseAssetDownloader();
    const toolsBinDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-tools-service-'));
    tempDirs.push(toolsBinDir);
    const sha256 = createHash('sha256').update(downloader.bytes).digest('hex');
    setupTools(client, [{
      id: 'a365-teams',
      displayName: 'A365 Teams CLI',
      description: 'Read and post Teams messages.',
      install: {
        type: 'github-release-asset',
        owner: 'agency-microsoft',
        repo: 'a365-cli',
        tag: 'v0.5.0',
        assets: [{ platform: process.platform, arch: process.arch, name: 'teams.exe', sha256 }],
      },
      bin: 'teams',
      help: 'teams --help',
      agentInstructions: 'Use teams read.',
    }]);
    svc = new ToolsService(
      new MarketplaceToolCatalog(client, [SOURCE]),
      new ToolInstaller(runner, downloader, toolsBinDir),
      store,
    );

    const outcome = await svc.reconcile();

    expect(outcome.errors).toEqual([]);
    expect(outcome.installed).toHaveLength(1);
    expect(store.config.installedTools?.[0]).toMatchObject({
      id: 'a365-teams',
      version: 'v0.5.0',
      bin: 'teams',
      help: 'teams --help',
      agentInstructions: 'Use teams read.',
      install: {
        type: 'github-release-asset',
        owner: 'agency-microsoft',
        repo: 'a365-cli',
        tag: 'v0.5.0',
        assetName: 'teams.exe',
        sha256,
      },
    });
  });

  it('reconcile updates an installed release asset tool when the marketplace tag changes', async () => {
    const downloader = new FakeReleaseAssetDownloader();
    const toolsBinDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-tools-service-'));
    tempDirs.push(toolsBinDir);
    const sha256 = createHash('sha256').update(downloader.bytes).digest('hex');
    store.config.installedTools = [{
      id: 'a365-teams',
      version: 'v0.4.0',
      bin: 'teams',
      displayName: 'A365 Teams CLI',
      description: 'Old description.',
      source: { marketplaceId: 'github:ianphil/genesis-minds', pluginId: 'genesis-minds' },
      installedAt: '2026-05-01T00:00:00.000Z',
      install: {
        type: 'github-release-asset',
        owner: 'agency-microsoft',
        repo: 'a365-cli',
        tag: 'v0.4.0',
        assetName: 'teams.exe',
        sha256: '1'.repeat(64),
        platform: process.platform,
        arch: process.arch,
        installedPath: path.join(toolsBinDir, 'teams.exe'),
      },
    }];
    setupTools(client, [{
      id: 'a365-teams',
      displayName: 'A365 Teams CLI',
      description: 'Read and post Teams messages.',
      install: {
        type: 'github-release-asset',
        owner: 'agency-microsoft',
        repo: 'a365-cli',
        tag: 'v0.5.0',
        assets: [{ platform: process.platform, arch: process.arch, name: 'teams.exe', sha256 }],
      },
      bin: 'teams',
    }]);
    svc = new ToolsService(
      new MarketplaceToolCatalog(client, [SOURCE]),
      new ToolInstaller(runner, downloader, toolsBinDir),
      store,
    );

    const outcome = await svc.reconcile();

    expect(outcome.installed.map((tool) => tool.id)).toEqual(['a365-teams']);
    expect(store.config.installedTools?.[0].version).toBe('v0.5.0');
  });
});

function installedRecord(): InstalledTool {
  return {
    id: 'workiq',
    package: '@microsoft/workiq',
    version: 'latest',
    bin: 'workiq',
    displayName: 'Microsoft Work IQ',
    description: 'Query M365 data.',
    help: 'workiq ask --help',
    agentInstructions: 'Use workiq ask.',
    source: { marketplaceId: 'github:ianphil/genesis-minds', pluginId: 'genesis-minds' },
    installedAt: '2026-05-07T21:00:00.000Z',
  };
}
