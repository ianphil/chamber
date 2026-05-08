import { describe, it, expect, beforeEach } from 'vitest';
import type { AppConfig, InstalledTool } from '@chamber/shared/types';
import { ToolsService } from './ToolsService';
import { MarketplaceToolCatalog } from './MarketplaceToolCatalog';
import { ToolInstaller, type CommandRunner, type CommandResult } from './ToolInstaller';
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
