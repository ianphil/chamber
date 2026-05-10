import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ConfigService } from '../config/ConfigService';
import { IdentityLoader } from '../chat/IdentityLoader';
import { MindManager } from '../mind/MindManager';
import { MarketplaceToolCatalog } from './MarketplaceToolCatalog';
import { ToolInstaller, type CommandRunner, type CommandResult } from './ToolInstaller';
import { ToolsService } from './ToolsService';
import type { CopilotClientFactory } from '../sdk/CopilotClientFactory';
import type { ViewDiscovery } from '../lens/ViewDiscovery';

class FakeRegistryClient {
  manifests = new Map<string, unknown>();
  async fetchTree(): Promise<never[]> { return []; }
  async fetchJsonContent(_owner: string, _repo: string, filePath: string): Promise<unknown> {
    return this.manifests.get(filePath) ?? {};
  }
}

class FakeRunner implements CommandRunner {
  calls: Array<{ command: string; args: string[] }> = [];
  async run(command: string, args: string[]): Promise<CommandResult> {
    this.calls.push({ command, args });
    return { exitCode: 0, stdout: '', stderr: '' };
  }
}

const SOURCE = {
  id: 'github:ianphil/genesis-minds',
  label: 'Public Genesis Minds',
  url: 'https://github.com/ianphil/genesis-minds',
  owner: 'ianphil',
  repo: 'genesis-minds',
  ref: 'master',
  plugin: 'genesis-minds',
  enabled: true,
};

const WORKIQ_ENTRY = {
  id: 'workiq',
  displayName: 'Microsoft Work IQ',
  description: 'Query M365 data via natural language.',
  install: { type: 'npm-global', package: '@microsoft/workiq', version: 'latest' },
  bin: 'workiq',
  help: 'workiq ask --help',
  agentInstructions: 'Use `workiq ask "<question>"` to query M365 data.',
};

function makeFakeMind(rootDir: string): string {
  const mindPath = path.join(rootDir, 'mind');
  fs.mkdirSync(path.join(mindPath, '.github', 'agents'), { recursive: true });
  fs.mkdirSync(path.join(mindPath, '.working-memory'), { recursive: true });
  fs.writeFileSync(path.join(mindPath, 'SOUL.md'), '# TestMind\nI am a test mind.');
  return mindPath;
}

function makeSessionStub(id = 'session-1') {
  return {
    sessionId: id,
    send: vi.fn(),
    sendAndWait: vi.fn(),
    getMessages: vi.fn(async (): Promise<unknown[]> => []),
    on: vi.fn(),
    off: vi.fn(),
    disconnect: vi.fn(async () => undefined),
    setModel: vi.fn(async () => undefined),
    rpc: { permissions: { setApproveAll: vi.fn(async () => ({ success: true })) } },
  };
}

function makeFakeClientFactory(): CopilotClientFactory {
  let counter = 0;
  const capturedSystemMessages: string[] = [];
  const fakeClient = {
    createSession: vi.fn((config: Record<string, unknown>) => {
      counter += 1;
      const sysMsg = config.systemMessage as
        | { sections?: { identity?: { content?: string } } }
        | undefined;
      const content = sysMsg?.sections?.identity?.content ?? '';
      capturedSystemMessages.push(content);
      return Promise.resolve(makeSessionStub(`session-${counter}`));
    }),
    resumeSession: vi.fn((sessionId: string) => Promise.resolve(makeSessionStub(sessionId))),
    deleteSession: vi.fn(async () => undefined),
    listAvailableModels: vi.fn(async () => []),
    listSessions: vi.fn(async () => []),
    getMessages: vi.fn(async () => []),
  };
  return Object.assign({}, {
    createClient: vi.fn(async () => fakeClient),
    destroyClient: vi.fn(async () => undefined),
    capturedSystemMessages,
  }) as unknown as CopilotClientFactory;
}

const fakeViewDiscovery = {
  ensureMind: vi.fn(),
  releaseMind: vi.fn(),
  removeMind: vi.fn(),
  scan: vi.fn(async () => undefined),
  startWatching: vi.fn(),
  stopWatching: vi.fn(),
  getViews: vi.fn(() => []),
  on: vi.fn(),
  off: vi.fn(),
  setRefreshHandler: vi.fn(),
  refreshView: vi.fn(),
  sendCanvasAction: vi.fn(),
  getCanvasUrl: vi.fn(),
} as unknown as ViewDiscovery;

describe('Marketplace tools end-to-end integration', () => {
  let rootDir: string;
  let userDataDir: string;
  let mindPath: string;
  let configService: ConfigService;
  let registryClient: FakeRegistryClient;
  let runner: FakeRunner;
  let toolsService: ToolsService;
  let identityLoader: IdentityLoader;
  let clientFactory: ReturnType<typeof makeFakeClientFactory>;

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-tools-int-'));
    userDataDir = path.join(rootDir, 'user-data');
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(path.join(userDataDir, 'config.json'), JSON.stringify({
      version: 2,
      minds: [],
      activeMindId: null,
      activeLogin: null,
      theme: 'dark',
    }));
    mindPath = makeFakeMind(rootDir);

    configService = new ConfigService(userDataDir);
    registryClient = new FakeRegistryClient();
    registryClient.manifests.set('plugins/genesis-minds/plugin.json', { tools: [WORKIQ_ENTRY] });
    runner = new FakeRunner();
    toolsService = new ToolsService(
      new MarketplaceToolCatalog(registryClient, [SOURCE]),
      new ToolInstaller(runner),
      configService,
    );
    identityLoader = new IdentityLoader(() => configService.load().installedTools ?? []);
    clientFactory = makeFakeClientFactory() as unknown as ReturnType<typeof makeFakeClientFactory>;
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it('reconcile installs workiq, persists it, and IdentityLoader appends it to the system message', async () => {
    const outcome = await toolsService.reconcile();
    expect(outcome.installed.map((t) => t.id)).toEqual(['workiq']);
    expect(runner.calls[0]).toEqual({ command: 'npm', args: ['install', '-g', '@microsoft/workiq@latest'] });

    const persistedConfig = configService.load();
    expect(persistedConfig.installedTools).toHaveLength(1);
    expect(persistedConfig.installedTools?.[0].id).toBe('workiq');

    const identity = identityLoader.load(mindPath);
    expect(identity?.systemMessage).toContain('## Tools');
    expect(identity?.systemMessage).toContain('### workiq — Microsoft Work IQ');
    expect(identity?.systemMessage).toContain('workiq ask --help');
  });

  it('persistConfig from MindManager preserves installedTools across mind operations', async () => {
    await toolsService.reconcile();
    expect(configService.load().installedTools).toHaveLength(1);

    const mindManager = new MindManager(clientFactory, identityLoader, configService, fakeViewDiscovery);
    await mindManager.loadMind(mindPath);

    // Multiple persist passes should not lose installedTools
    expect(configService.load().installedTools).toHaveLength(1);
    expect(configService.load().installedTools?.[0].id).toBe('workiq');
  });

  it('startNewConversation refreshes identity so a new session sees newly-installed tools after reconcile', async () => {
    // App started before reconcile finished — no tools at mind-load time
    const mindManager = new MindManager(clientFactory, identityLoader, configService, fakeViewDiscovery);
    const mind = await mindManager.loadMind(mindPath);
    expect(mind.identity.systemMessage).not.toContain('## Tools');

    // Reconcile finishes after the mind is already loaded
    await toolsService.reconcile();
    expect(configService.load().installedTools).toHaveLength(1);

    // Cached identity is still stale right after reconcile
    expect(mindManager.getMind(mind.mindId)?.identity.systemMessage).not.toContain('## Tools');

    // Mark the active conversation as having messages so startNewConversation actually creates a fresh session
    mindManager.markActiveConversationHasMessages(mind.mindId, 'first prompt');

    // Starting a new conversation refreshes the identity from disk + installedTools
    await mindManager.startNewConversation(mind.mindId);
    const refreshed = mindManager.getMind(mind.mindId);
    expect(refreshed?.identity.systemMessage).toContain('## Tools');
    expect(refreshed?.identity.systemMessage).toContain('workiq ask --help');

    // The new SDK session was constructed with the refreshed system message
    const captured = (clientFactory as unknown as { capturedSystemMessages: string[] }).capturedSystemMessages;
    expect(captured.at(-1)).toContain('## Tools');
  });

  it('empty-draft path also recreates the SDK session when identity changed', async () => {
    const mindManager = new MindManager(clientFactory, identityLoader, configService, fakeViewDiscovery);
    const mind = await mindManager.loadMind(mindPath);
    const initialSession = mindManager.getMind(mind.mindId)?.session;
    expect(initialSession).toBeDefined();

    // Reconcile happens after mind load; the active conversation is still an empty draft (no messages)
    await toolsService.reconcile();

    await mindManager.startNewConversation(mind.mindId);
    const next = mindManager.getMind(mind.mindId);
    expect(next?.identity.systemMessage).toContain('## Tools');
    expect(next?.session).not.toBe(initialSession);
    const captured = (clientFactory as unknown as { capturedSystemMessages: string[] }).capturedSystemMessages;
    expect(captured.at(-1)).toContain('## Tools');
  });
});
