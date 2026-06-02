import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import { MindManager } from './MindManager';
import { approveForSessionCompat } from '../sdk/approveForSessionCompat';
import type { CopilotClientFactory } from '../sdk/CopilotClientFactory';
import type { IdentityLoader } from '../chat/IdentityLoader';
import type { ChamberToolProvider } from '../chamberTools';
import type { ConfigService } from '../config/ConfigService';
import type { ViewDiscovery } from '../lens/ViewDiscovery';
import type { AppConfig, LensViewManifest, MindContext } from '@chamber/shared/types';
import { MindScaffold } from '../genesis/MindScaffold';
import type { ManagedSkillSyncResult } from '../skills';

// --- Mocks ---

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(() => []),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  rmSync: vi.fn(),
  realpathSync: Object.assign(vi.fn((candidate: string) => candidate), {
    native: vi.fn((candidate: string) => candidate),
  }),
}));

vi.mock('../lens/MindBootstrap', () => ({
  bootstrapMindCapabilities: vi.fn(),
}));

vi.mock('./chamberMindConfig', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./chamberMindConfig')>();
  return {
    ...actual,
    patchChamberMindConfig: vi.fn(),
  };
});

vi.mock('../mindMemory/rollback', () => ({
  rollbackToUnstructured: vi.fn().mockResolvedValue({
    framesConverted: 0,
    legacyExisted: false,
    outcome: 'no-op-missing',
  }),
}));

import * as fs from 'fs';
import { bootstrapMindCapabilities } from '../lens/MindBootstrap';
import { patchChamberMindConfig } from './chamberMindConfig';
import { rollbackToUnstructured } from '../mindMemory/rollback';

const mockStart = vi.fn();
const mockStop = vi.fn();
let sessionCounter = 0;
function createSessionStub(sessionId = `sdk-session-${sessionCounter += 1}`) {
  return {
  sessionId,
  send: vi.fn(),
  sendAndWait: vi.fn(),
  getEvents: vi.fn(async (): Promise<unknown[]> => []),
  on: vi.fn(),
  off: vi.fn(),
  disconnect: vi.fn(async () => undefined),
  setModel: vi.fn(async () => undefined),
  rpc: { permissions: { setApproveAll: vi.fn(async () => ({ success: true })) } },
  };
}

const mockCreateSession = vi.fn((config: Record<string, unknown>) => {
  return createSessionStub(typeof config.sessionId === 'string' ? config.sessionId : undefined);
});
const mockResumeSession = vi.fn((sessionId: string, config: Record<string, unknown>) => {
  void config;
  return createSessionStub(sessionId);
});
const mockDeleteSession = vi.fn(async (sessionId: string) => {
  void sessionId;
});

function makeMockClient() {
  return {
    start: mockStart,
    stop: mockStop,
    createSession: mockCreateSession,
    resumeSession: mockResumeSession,
    deleteSession: mockDeleteSession,
  };
}

const mockClientFactory = {
  createClient: vi.fn(async () => makeMockClient()),
  destroyClient: vi.fn(),
};

const mockIdentityLoader = {
  load: vi.fn((mindPath: string) => ({
    name: mindPath.split('/').pop() ?? 'unknown',
    systemMessage: `Identity for ${mindPath}`,
  })),
};

const mockProvider = {
  getToolsForMind: vi.fn<(_: string, __: string) => unknown[]>(() => []),
  activateMind: vi.fn(async (mindId: string, mindPath: string) => {
    void mindId;
    void mindPath;
  }),
  releaseMind: vi.fn(async (mindId: string) => {
    void mindId;
  }),
};

let currentConfig: AppConfig = {
  version: 2,
  minds: [],
  activeMindId: null,
  activeLogin: null,
  theme: 'dark',
};

const mockConfigService = {
  getConfigDir: vi.fn(() => 'C:\\tmp\\chamber-config'),
  load: vi.fn(() => currentConfig),
  save: vi.fn((config) => {
    currentConfig = config;
  }),
};

const mockViewDiscovery = {
  scan: vi.fn<(_: string) => Promise<LensViewManifest[]>>(async () => []),
  getViews: vi.fn<() => LensViewManifest[]>(() => []),
  startWatching: vi.fn<(_: string, __: () => void) => void>(),
  stopWatching: vi.fn(),
  removeMind: vi.fn(),
  setRefreshHandler: vi.fn(),
};

const COPILOT_RUNTIME_CONFIG_DIR = path.join('C:\\tmp\\chamber-config', 'copilot-runtime');

function lastSavedConfig(): AppConfig {
  const config = mockConfigService.save.mock.calls.at(-1)?.[0] as AppConfig | undefined;
  if (!config) throw new Error('Expected config to be saved');
  return config;
}

function savedMindIds(config: AppConfig): string[] {
  return config.minds.map(record => record.id).sort();
}

describe('MindManager', () => {
  let manager: MindManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProvider.getToolsForMind.mockReset();
    mockProvider.activateMind.mockReset();
    mockProvider.releaseMind.mockReset();
    mockProvider.getToolsForMind.mockImplementation(() => []);
    mockProvider.activateMind.mockImplementation(async () => { /* noop */ });
    mockProvider.releaseMind.mockImplementation(async () => { /* noop */ });
    mockConfigService.load.mockReset();
    mockConfigService.save.mockReset();
    mockConfigService.getConfigDir.mockReset();
    mockConfigService.getConfigDir.mockReturnValue('C:\\tmp\\chamber-config');
    mockConfigService.load.mockImplementation(() => currentConfig);
    mockConfigService.save.mockImplementation((config) => {
      currentConfig = config;
    });
    currentConfig = {
      version: 2,
      minds: [],
      activeMindId: null,
      activeLogin: null,
      theme: 'dark',
    };
    mockCreateSession.mockImplementation((config: Record<string, unknown>) => {
      return createSessionStub(typeof config.sessionId === 'string' ? config.sessionId : undefined);
    });
    mockResumeSession.mockImplementation((sessionId: string, config: Record<string, unknown>) => {
      void config;
      return createSessionStub(sessionId);
    });
    mockDeleteSession.mockImplementation(async (sessionId: string) => {
      void sessionId;
    });
    vi.mocked(fs.existsSync).mockImplementation((candidate) => {
      // Default: every checked path exists EXCEPT `.mcp.json` and
      // `.chamber.json`. Tests that need MindManager to discover either
      // file opt in by overriding existsSync + readFileSync per test
      // (#199 / #131). Without the chamber.json exclusion, the default
      // readFileSync stub ('# TestAgent\nSome content') fails JSON.parse
      // and pollutes every test with a chamberMindConfig warn.
      const s = String(candidate);
      return !s.endsWith('.mcp.json') && !s.endsWith('.chamber.json');
    });
    vi.mocked(fs.readFileSync).mockReturnValue('# TestAgent\nSome content');
    vi.mocked(fs.realpathSync.native).mockImplementation((candidate) => String(candidate));
    manager = new MindManager(
      mockClientFactory as unknown as CopilotClientFactory,
      mockIdentityLoader as unknown as IdentityLoader,
      mockConfigService as unknown as ConfigService,
      mockViewDiscovery as unknown as ViewDiscovery,
    );
    manager.setProviders([mockProvider as unknown as ChamberToolProvider]);
  });

  describe('loadMind', () => {
    it('runs the .chamber gitignore migration for existing minds on load', async () => {
      const ensureChamberGitignore = vi
        .spyOn(MindScaffold, 'ensureChamberGitignore')
        .mockReturnValue(true);
      try {
        await manager.loadMind('/tmp/agents/q');

        expect(ensureChamberGitignore).toHaveBeenCalledWith('/tmp/agents/q');
      } finally {
        ensureChamberGitignore.mockRestore();
      }
    });

    it('loads a mind from a valid directory', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      expect(mind.mindPath).toBe('/tmp/agents/q');
      expect(mind.identity.name).toBe('q');
      expect(mind.status).toBe('ready');
      expect(mockClientFactory.createClient).toHaveBeenCalledWith('/tmp/agents/q');
      expect(mockProvider.getToolsForMind).toHaveBeenCalledWith(
        expect.stringMatching(/^q-/),
        '/tmp/agents/q',
      );
      expect(mockConfigService.save).toHaveBeenCalled();
    });

    it('creates a named chamber session and persists conversation metadata', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      const sessionConfig = mockCreateSession.mock.calls[0][0] as { sessionId?: string };

      expect(sessionConfig.sessionId).toMatch(new RegExp(`^chamber-${mind.mindId}-`));
      expect(lastSavedConfig().minds[0]).toMatchObject({
        id: mind.mindId,
        activeSessionId: sessionConfig.sessionId,
        conversations: [expect.objectContaining({
          sessionId: sessionConfig.sessionId,
          kind: 'chat',
          hasMessages: false,
        })],
      });
    });

    it('isolates SDK runtime config and disables implicit discovery for mind sessions', async () => {
      await manager.loadMind('/tmp/agents/q');

      expect(mockCreateSession).toHaveBeenCalledWith(expect.objectContaining({
        configDir: COPILOT_RUNTIME_CONFIG_DIR,
        enableConfigDiscovery: false,
      }));
    });

    it('resumes a persisted active conversation when restoring a mind', async () => {
      currentConfig = {
        version: 2,
        minds: [{
          id: 'q-a1b2',
          path: '/tmp/agents/q',
          activeSessionId: 'chamber-q-a1b2-existing',
          conversations: [{
            sessionId: 'chamber-q-a1b2-existing',
            title: 'Existing chat',
            createdAt: '2026-05-05T22:00:00.000Z',
            updatedAt: '2026-05-05T22:00:00.000Z',
            kind: 'chat',
          }],
        }],
        activeMindId: 'q-a1b2',
        activeLogin: null,
        theme: 'dark',
      };

      await manager.restoreFromConfig();

      expect(mockResumeSession).toHaveBeenCalledWith(
        'chamber-q-a1b2-existing',
        expect.objectContaining({
          workingDirectory: '/tmp/agents/q',
          configDir: COPILOT_RUNTIME_CONFIG_DIR,
          enableConfigDiscovery: false,
        }),
      );
      expect(manager.listMinds()[0].activeSessionId).toBe('chamber-q-a1b2-existing');
    });

    it('injects current datetime context into background prompts', async () => {
      await manager.loadMind('/tmp/agents/q');
      const session = mockCreateSession.mock.results.at(-1)?.value;
      session.on.mockImplementation((event: string, callback: () => void) => {
        if (event === 'session.idle') setTimeout(callback, 0);
        return vi.fn();
      });
      await manager.sendBackgroundPrompt('/tmp/agents/q', 'do background work');

      const sentPrompt = session.send.mock.calls[0]?.[0]?.prompt;
      expect(sentPrompt).toEqual(expect.stringContaining('<current_datetime>'));
      expect(sentPrompt).toEqual(expect.stringContaining('<timezone>'));
      expect(sentPrompt).toEqual(expect.stringContaining('do background work'));
    });

    it('runs automation prompts in an isolated session without touching the active conversation', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      const activeSession = manager.getMind(mind.mindId)?.session as unknown as ReturnType<typeof createSessionStub>;
      const activeSessionId = manager.getMind(mind.mindId)?.activeSessionId;
      mockConfigService.save.mockClear();

      const answer = 'isolated answer';
      mockCreateSession.mockImplementationOnce((config: Record<string, unknown>) => {
        const session = createSessionStub(typeof config.sessionId === 'string' ? config.sessionId : undefined);
        session.sendAndWait.mockResolvedValueOnce({
          type: 'assistant.message',
          data: { content: answer, messageId: 'assistant-1' },
        });
        return session;
      });

      const result = await manager.runIsolatedPrompt(mind.mindId, 'summarize current state');

      const isolatedSession = mockCreateSession.mock.results.at(-1)?.value;
      expect(result).toBe(answer);
      expect(isolatedSession).not.toBe(activeSession);
      expect(isolatedSession.sendAndWait).toHaveBeenCalledWith(
        { prompt: expect.stringContaining('summarize current state') },
        120_000,
      );
      expect(isolatedSession.sendAndWait.mock.calls[0]?.[0].prompt).toEqual(expect.stringContaining('<current_datetime>'));
      expect(isolatedSession.disconnect).toHaveBeenCalled();
      expect(activeSession.send).not.toHaveBeenCalled();
      expect(activeSession.sendAndWait).not.toHaveBeenCalled();
      expect(activeSession.disconnect).not.toHaveBeenCalled();
      expect(manager.getMind(mind.mindId)?.session).toBe(activeSession);
      expect(manager.getMind(mind.mindId)?.activeSessionId).toBe(activeSessionId);
      expect(mockConfigService.save).not.toHaveBeenCalled();
    });

    it('uses a persisted per-mind model when creating the session', async () => {
      currentConfig = {
        version: 2,
        minds: [{ id: 'q-a1b2', path: '/tmp/agents/q', selectedModel: 'gpt-5.4' }],
        activeMindId: 'q-a1b2',
        activeLogin: null,
        theme: 'dark',
      };

      await manager.restoreFromConfig();

      expect(mockCreateSession).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-5.4' }));
      expect(manager.listMinds()[0].selectedModel).toBe('gpt-5.4');
    });

    it('persists a per-mind model and updates the live session in place via setModel', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      manager.markActiveConversationHasMessages(mind.mindId, 'Existing context');
      mockCreateSession.mockClear();
      mockResumeSession.mockClear();
      const liveSession = manager.getMind(mind.mindId)?.session as unknown as ReturnType<typeof createSessionStub>;

      const updated = await manager.setMindModel(mind.mindId, 'claude-opus');

      expect(updated?.selectedModel).toBe('claude-opus');
      expect(lastSavedConfig().minds[0].selectedModel).toBe('claude-opus');
      expect(mockCreateSession).not.toHaveBeenCalled();
      expect(mockResumeSession).not.toHaveBeenCalled();
      expect(liveSession.setModel).toHaveBeenCalledWith('claude-opus');
      expect(liveSession.disconnect).not.toHaveBeenCalled();
      expect(manager.getMind(mind.mindId)?.session).toBe(liveSession);
      expect(manager.listConversationHistory(mind.mindId)).toHaveLength(1);
      expect(manager.listConversationHistory(mind.mindId)[0].title).toBe('Existing context');
    });

    it('persists a per-mind model on an empty draft via setModel without recreating the session', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      mockCreateSession.mockClear();
      mockResumeSession.mockClear();
      const liveSession = manager.getMind(mind.mindId)?.session as unknown as ReturnType<typeof createSessionStub>;

      const updated = await manager.setMindModel(mind.mindId, 'claude-opus');

      expect(updated?.selectedModel).toBe('claude-opus');
      expect(mockResumeSession).not.toHaveBeenCalled();
      expect(mockCreateSession).not.toHaveBeenCalled();
      expect(liveSession.setModel).toHaveBeenCalledWith('claude-opus');
      expect(manager.getMind(mind.mindId)?.activeSessionId).toBe(mind.activeSessionId);
      expect(manager.listConversationHistory(mind.mindId)).toHaveLength(1);
    });

    it('persists the new selectedModel before invoking setModel so stale recovery uses the requested model', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      manager.markActiveConversationHasMessages(mind.mindId, 'Existing context');
      const liveSession = manager.getMind(mind.mindId)?.session as unknown as ReturnType<typeof createSessionStub>;
      let observedDuringFailure: string | undefined;
      liveSession.setModel.mockImplementationOnce(async () => {
        observedDuringFailure = manager.getMind(mind.mindId)?.selectedModel;
        throw new Error('Session not found: stale-runtime');
      });

      await expect(manager.setMindModel(mind.mindId, 'claude-opus')).rejects.toThrow(/Session not found/);
      expect(observedDuringFailure).toBe('claude-opus');
      expect(manager.getMind(mind.mindId)?.selectedModel).toBe('claude-opus');
    });

    it('rolls back the persisted selection when the SDK rejects with a non-stale error', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      manager.markActiveConversationHasMessages(mind.mindId, 'Existing context');
      const before = manager.getMind(mind.mindId)?.selectedModel;
      const beforeProvider = manager.getMind(mind.mindId)?.selectedModelProvider;
      const liveSession = manager.getMind(mind.mindId)?.session as unknown as ReturnType<typeof createSessionStub>;
      liveSession.setModel.mockImplementationOnce(async () => {
        throw new Error('BYO endpoint unreachable: connect ECONNREFUSED 127.0.0.1:11434');
      });

      await expect(manager.setMindModel(mind.mindId, 'claude-opus')).rejects.toThrow(/ECONNREFUSED/);
      expect(manager.getMind(mind.mindId)?.selectedModel).toBe(before);
      expect(manager.getMind(mind.mindId)?.selectedModelProvider).toBe(beforeProvider);
    });

    it('serializes concurrent per-mind model changes against the live session', async () => {
      const liveSession = manager.getMind((await manager.loadMind('/tmp/agents/q')).mindId)?.session as unknown as ReturnType<typeof createSessionStub>;
      const mind = manager.listMinds()[0];
      manager.markActiveConversationHasMessages(mind.mindId, 'Existing context');
      mockCreateSession.mockClear();
      mockResumeSession.mockClear();
      liveSession.setModel.mockClear();

      let resolveFirst: (() => void) | undefined;
      liveSession.setModel.mockImplementationOnce(async () => {
        await new Promise<void>((resolve) => {
          resolveFirst = () => resolve();
        });
      });
      liveSession.setModel.mockResolvedValueOnce(undefined);

      const firstChange = manager.setMindModel(mind.mindId, 'model-a');
      const secondChange = manager.setMindModel(mind.mindId, 'model-b');
      await Promise.resolve();
      await Promise.resolve();

      expect(liveSession.setModel).toHaveBeenCalledTimes(1);
      expect(liveSession.setModel).toHaveBeenCalledWith('model-a');

      resolveFirst?.();
      await Promise.all([firstChange, secondChange]);

      expect(mockCreateSession).not.toHaveBeenCalled();
      expect(mockResumeSession).not.toHaveBeenCalled();
      expect(liveSession.setModel).toHaveBeenCalledTimes(2);
      expect(liveSession.setModel).toHaveBeenLastCalledWith('model-b');
      expect(liveSession.disconnect).not.toHaveBeenCalled();
      expect(manager.getMind(mind.mindId)?.selectedModel).toBe('model-b');
      expect(manager.getMind(mind.mindId)?.session).toBe(liveSession);
    });

    it('bootstraps managed mind capabilities before creating the SDK session', async () => {
      await manager.loadMind('/tmp/agents/q');

      expect(bootstrapMindCapabilities).toHaveBeenCalledWith('/tmp/agents/q');
      expect(mockClientFactory.createClient).toHaveBeenCalledWith('/tmp/agents/q');
      expect(vi.mocked(bootstrapMindCapabilities).mock.invocationCallOrder[0])
        .toBeLessThan(mockClientFactory.createClient.mock.invocationCallOrder[0]);
    });

    it('installs marketplace managed skills before creating the SDK session', async () => {
      const managedSkillService = {
        installIntoMind: vi.fn(async (): Promise<ManagedSkillSyncResult> => ({ status: 'ok', installed: [], errors: [] })),
      };
      manager = new MindManager(
        mockClientFactory as unknown as CopilotClientFactory,
        mockIdentityLoader as unknown as IdentityLoader,
        mockConfigService as unknown as ConfigService,
        mockViewDiscovery as unknown as ViewDiscovery,
        () => null,
        () => undefined,
        () => true,
        managedSkillService,
      );

      await manager.loadMind('/tmp/agents/q');

      expect(managedSkillService.installIntoMind).toHaveBeenCalledWith('/tmp/agents/q');
      expect(managedSkillService.installIntoMind.mock.invocationCallOrder[0])
        .toBeLessThan(mockClientFactory.createClient.mock.invocationCallOrder[0]);
    });

    it('continues loading when managed mind capability bootstrap fails', async () => {
      vi.mocked(bootstrapMindCapabilities).mockImplementationOnce(() => {
        throw new Error('skill asset missing');
      });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(vi.fn());

      const mind = await manager.loadMind('/tmp/agents/q');

      expect(mind.status).toBe('ready');
      expect(mockClientFactory.createClient).toHaveBeenCalledWith('/tmp/agents/q');
      warnSpy.mockRestore();
    });

    it('starts Lens watching and emits view changes after watcher rescans', async () => {
      const listener = vi.fn();
      const views: LensViewManifest[] = [{
        id: 'smoke-view',
        name: 'Smoke View',
        icon: 'table',
        view: 'table',
        source: 'data.json',
      }];
      mockViewDiscovery.getViews.mockReturnValue(views);
      manager.on('lens:viewsChanged', listener);

      await manager.loadMind('/tmp/agents/q');
      const onChanged = mockViewDiscovery.startWatching.mock.calls[0]?.[1];
      onChanged?.();

      expect(mockViewDiscovery.startWatching).toHaveBeenCalledWith('/tmp/agents/q', expect.any(Function));
      expect(mockViewDiscovery.getViews).toHaveBeenCalledWith('/tmp/agents/q');
      expect(listener).toHaveBeenCalledWith(views, expect.stringMatching(/^q-/));
    });

    it('generates a stable mind ID from folder name', async () => {
      const mind = await manager.loadMind('/tmp/agents/fox');
      expect(mind.mindId).toMatch(/^fox-[a-f0-9]{4}$/);
    });

    it('throws on invalid directory (no SOUL.md or .github)', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      await expect(manager.loadMind('/tmp/invalid')).rejects.toThrow();
    });

    it('resolves nested directories to the nearest mind root', async () => {
      vi.mocked(fs.existsSync).mockImplementation((candidate) => {
        const normalized = String(candidate).replace(/\\/g, '/');
        return normalized === '/tmp/agents/q/SOUL.md' || normalized === '/tmp/agents/q/.github';
      });

      const mind = await manager.loadMind('/tmp/agents/q/domains');
      const createClientCalls = (mockClientFactory.createClient as unknown as { mock: { calls: Array<[string]> } }).mock.calls;
      const lastCreateClientPath = String(
        createClientCalls[createClientCalls.length - 1]?.[0] ?? '',
      );

      expect(mind.mindPath.replace(/\\/g, '/')).toBe('/tmp/agents/q');
      expect(lastCreateClientPath.replace(/\\/g, '/')).toBe('/tmp/agents/q');
    });

    it('deduplicates — same path loaded twice returns existing mind', async () => {
      const mind1 = await manager.loadMind('/tmp/agents/q');
      const mind2 = await manager.loadMind('/tmp/agents/q');
      expect(mind1.mindId).toBe(mind2.mindId);
      expect(mockClientFactory.createClient).toHaveBeenCalledTimes(1);
    });

    it('deduplicates equivalent path spellings before creating another client', async () => {
      vi.mocked(fs.existsSync).mockImplementation((candidate) => {
        const normalized = String(candidate).replace(/\\/g, '/').toLowerCase();
        return normalized === '/tmp/agents/q/soul.md' || normalized === '/tmp/agents/q/.github';
      });
      vi.mocked(fs.realpathSync.native).mockImplementation((candidate) =>
        String(candidate).replace(/\\/g, '/').toLowerCase(),
      );

      const mind1 = await manager.loadMind('/tmp/agents/q');
      const mind2 = await manager.loadMind('/tmp/agents/Q/');

      expect(mind2.mindId).toBe(mind1.mindId);
      expect(mockClientFactory.createClient).toHaveBeenCalledTimes(1);
      expect(mockCreateSession).toHaveBeenCalledTimes(1);
      expect(mockProvider.activateMind).toHaveBeenCalledTimes(1);
    });

    it('deduplicates filesystem aliases by realpath before creating another client', async () => {
      vi.mocked(fs.existsSync).mockImplementation((candidate) => {
        return !String(candidate).endsWith('.mcp.json');
      });
      vi.mocked(fs.realpathSync.native).mockImplementation((candidate) => {
        const normalized = String(candidate).replace(/\\/g, '/');
        if (normalized.endsWith('/tmp/aliases/q-link')) {
          return normalized.slice(0, -'/tmp/aliases/q-link'.length) + '/tmp/agents/q';
        }
        return normalized;
      });

      const mind1 = await manager.loadMind('/tmp/agents/q');
      const mind2 = await manager.loadMind('/tmp/aliases/q-link');

      expect(mind2.mindId).toBe(mind1.mindId);
      expect(mockClientFactory.createClient).toHaveBeenCalledTimes(1);
      expect(mockCreateSession).toHaveBeenCalledTimes(1);
    });

    it('emits mind:loaded event', async () => {
      const listener = vi.fn();
      manager.on('mind:loaded', listener);
      await manager.loadMind('/tmp/agents/q');
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ mindPath: '/tmp/agents/q' }));
    });

    describe('display-name uniqueness (#44)', () => {
      // mockImplementation overrides on shared mocks persist across vi.clearAllMocks().
      // Re-install the basename-derived default each time so tests below us in the
      // file (and the rest of this describe) see consistent identity loader behavior.
      const defaultIdentityImpl = (mindPath: string) => ({
        name: mindPath.split('/').pop() ?? 'unknown',
        systemMessage: `Identity for ${mindPath}`,
      });
      beforeEach(() => {
        mockIdentityLoader.load.mockImplementation(defaultIdentityImpl);
      });
      afterEach(() => {
        mockIdentityLoader.load.mockImplementation(defaultIdentityImpl);
      });
      it('findByName returns the mind whose identity.name matches (case-insensitive)', async () => {
        await manager.loadMind('/tmp/agents/q');
        await manager.loadMind('/tmp/agents/fox');

        expect(manager.findByName('q')?.mindPath).toBe('/tmp/agents/q');
        expect(manager.findByName('Q')?.mindPath).toBe('/tmp/agents/q');
        expect(manager.findByName('  q  ')?.mindPath).toBe('/tmp/agents/q');
        expect(manager.findByName('fox')?.mindPath).toBe('/tmp/agents/fox');
        expect(manager.findByName('nonexistent')).toBeUndefined();
      });

      it('default loadMind (no options) does NOT enforce name uniqueness — preserves startup-replay behavior', async () => {
        // IdentityLoader mock returns identity.name = basename. Two distinct paths
        // with the same basename produce two minds with the same display name.
        // Pre-existing persisted configs may legitimately contain such pairs;
        // startup must not refuse to restore them.
        const a = await manager.loadMind('/tmp/agents/q');
        const b = await manager.loadMind('/tmp/other/q');

        expect(a.identity.name).toBe('q');
        expect(b.identity.name).toBe('q');
        expect(a.mindId).not.toBe(b.mindId);
      });

      it('loadMind with enforceUnique: true throws when name collides with an already-loaded mind at a different path', async () => {
        await manager.loadMind('/tmp/agents/q');

        await expect(
          manager.loadMind('/tmp/other/q', undefined, { enforceUnique: true }),
        ).rejects.toThrow(/already exists/i);
        // And the colliding mind must not have been registered or created any SDK state.
        expect(manager.listMinds()).toHaveLength(1);
      });

      it('loadMind with enforceUnique: true still deduplicates the same mind path (no collision against itself)', async () => {
        const first = await manager.loadMind('/tmp/agents/q');
        const second = await manager.loadMind('/tmp/agents/q', undefined, { enforceUnique: true });

        expect(second.mindId).toBe(first.mindId);
        expect(mockClientFactory.createClient).toHaveBeenCalledTimes(1);
      });

      it('loadMind with enforceUnique: true compares names case-insensitively', async () => {
        await manager.loadMind('/tmp/agents/Alfred');

        await expect(
          manager.loadMind('/tmp/other/alfred', undefined, { enforceUnique: true }),
        ).rejects.toThrow(/already exists/i);
      });

      it('loadMind with enforceUnique: true rolls back identity load without creating an SDK client', async () => {
        await manager.loadMind('/tmp/agents/q');
        const clientsBefore = mockClientFactory.createClient.mock.calls.length;

        await expect(
          manager.loadMind('/tmp/other/q', undefined, { enforceUnique: true }),
        ).rejects.toThrow(/already exists/i);

        // The collision is detected before clientFactory.createClient runs,
        // so no extra SDK client is spawned for the rejected load.
        expect(mockClientFactory.createClient.mock.calls.length).toBe(clientsBefore);
      });

      it('serializes concurrent enforce-unique loads with colliding names so only one succeeds', async () => {
        // Two concurrent loads of different paths whose IdentityLoader returns
        // the same name. Without a reservation, both would pass the
        // this.minds-only check (this.minds.set happens much later in the
        // pipeline, after client/session setup) and both would load.
        mockIdentityLoader.load.mockImplementation(() => ({
          name: 'alfred',
          systemMessage: 'identity',
        }));

        const results = await Promise.allSettled([
          manager.loadMind('/tmp/agents/butler-a', undefined, { enforceUnique: true }),
          manager.loadMind('/tmp/agents/butler-b', undefined, { enforceUnique: true }),
        ]);

        const fulfilled = results.filter((r) => r.status === 'fulfilled');
        const rejected = results.filter((r) => r.status === 'rejected');
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
          message: expect.stringMatching(/already exists/i),
        });
        expect(manager.listMinds()).toHaveLength(1);
      });

      it('findByName matches across Unicode normalization forms (NFC vs NFD)', async () => {
        // macOS clipboard often produces NFD ("Cafe\u0301"); Windows produces NFC ("Café").
        // Without normalization the duplicate check would let two visually-identical
        // names through. Loaded mind uses NFD; lookup uses NFC.
        const nfd = 'Cafe\u0301';
        const nfc = 'Café';
        expect(nfd).not.toBe(nfc);
        mockIdentityLoader.load.mockImplementation(() => ({
          name: nfd,
          systemMessage: 'identity',
        }));
        await manager.loadMind('/tmp/agents/cafe-nfd');

        expect(manager.findByName(nfc)?.mindPath).toBe('/tmp/agents/cafe-nfd');
        expect(manager.findByName(nfd)?.mindPath).toBe('/tmp/agents/cafe-nfd');
      });
    });

    it('wires approveForSessionCompat and does not short-circuit via setApproveAll (issue #131)', async () => {
      const created = createSessionStub();
      mockCreateSession.mockResolvedValueOnce(created);
      await manager.loadMind('/tmp/agents/q');
      const sessionConfig = mockCreateSession.mock.calls[0][0] as { onPermissionRequest?: unknown };
      expect(sessionConfig.onPermissionRequest).toBe(approveForSessionCompat);
      expect(created.rpc.permissions.setApproveAll).not.toHaveBeenCalled();
    });
  });

  describe('unloadMind', () => {
    it('releases providers, destroys client, and removes from map', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      await manager.unloadMind(mind.mindId);
      expect(mockProvider.releaseMind).toHaveBeenCalledWith(mind.mindId);
      expect(mockClientFactory.destroyClient).toHaveBeenCalled();
      expect(manager.getMind(mind.mindId)).toBeUndefined();
      expect(mockConfigService.save).toHaveBeenCalled();
    });

    it('emits mind:unloaded event', async () => {
      const listener = vi.fn();
      manager.on('mind:unloaded', listener);
      const mind = await manager.loadMind('/tmp/agents/q');
      await manager.unloadMind(mind.mindId);
      expect(listener).toHaveBeenCalledWith(mind.mindId);
    });

    it('is a no-op for non-existent mindId', async () => {
      await expect(manager.unloadMind('nonexistent')).resolves.not.toThrow();
    });

    it('falls back activeMindId when active mind is unloaded', async () => {
      const mind1 = await manager.loadMind('/tmp/agents/a');
      const mind2 = await manager.loadMind('/tmp/agents/b');
      manager.setActiveMind(mind1.mindId);
      await manager.unloadMind(mind1.mindId);
      // Should fall back to remaining mind or null
      const config = mockConfigService.save.mock.calls.at(-1)?.[0];
      expect(config?.activeMindId).toBe(mind2.mindId);
    });

    it('explicit unload still prunes the unloaded mind from persisted config', async () => {
      const mind1 = await manager.loadMind('/tmp/agents/q');
      const mind2 = await manager.loadMind('/tmp/agents/fox');

      await manager.unloadMind(mind1.mindId);

      expect(savedMindIds(lastSavedConfig())).toEqual([mind2.mindId]);
    });

    it('preserves marketplaceRegistries and installedTools across persist', async () => {
      currentConfig = {
        ...currentConfig,
        marketplaceRegistries: [{
          id: 'github:ianphil/genesis-minds',
          label: 'Public Genesis Minds',
          url: 'https://github.com/ianphil/genesis-minds',
          owner: 'ianphil',
          repo: 'genesis-minds',
          ref: 'master',
          plugin: 'genesis-minds',
          enabled: true,
          isDefault: true,
        }],
        installedTools: [{
          id: 'workiq',
          package: '@microsoft/workiq',
          version: 'latest',
          bin: 'workiq',
          displayName: 'Microsoft Work IQ',
          description: 'Query M365 data.',
          source: { marketplaceId: 'github:ianphil/genesis-minds', pluginId: 'genesis-minds' },
          installedAt: '2026-05-08T00:00:00.000Z',
        }],
      };
      await manager.loadMind('/tmp/agents/q');
      const saved = lastSavedConfig();
      expect(saved.marketplaceRegistries).toHaveLength(1);
      expect(saved.installedTools).toHaveLength(1);
      expect(saved.installedTools?.[0].id).toBe('workiq');
    });
  });

  describe('listMinds', () => {
    it('returns MindContext array (no internal details)', async () => {
      await manager.loadMind('/tmp/agents/q');
      await manager.loadMind('/tmp/agents/fox');
      const minds = manager.listMinds();
      expect(minds).toHaveLength(2);
      // Verify no internal properties leaked
      for (const m of minds) {
        expect(m).toHaveProperty('mindId');
        expect(m).toHaveProperty('mindPath');
        expect(m).toHaveProperty('identity');
        expect(m).toHaveProperty('status');
        expect(m).not.toHaveProperty('client');
        expect(m).not.toHaveProperty('session');
        expect(m).not.toHaveProperty('extensions');
      }
    });
  });

  describe('getMind', () => {
    it('returns internal context for valid ID', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      const internal = manager.getMind(mind.mindId);
      if (!internal) throw new Error('expected internal mind context');
      expect(internal.client).toBeDefined();
      expect(internal.session).toBeDefined();
    });

    it('returns undefined for invalid ID', () => {
      expect(manager.getMind('nonexistent')).toBeUndefined();
    });
  });

  describe('recreateSession', () => {
    it('replaces an empty active draft when recreating the session', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      const originalSessionId = mind.activeSessionId;

      await manager.recreateSession(mind.mindId);

      const newCtx = manager.getMind(mind.mindId);
      if (!newCtx) throw new Error('expected mind context after recreate');
      const newSession = newCtx.session;
      expect(newSession).toBeDefined();
      expect(mockCreateSession).toHaveBeenCalledTimes(2);
      const history = manager.listConversationHistory(mind.mindId);
      expect(history).toHaveLength(1);
      expect(history[0].active).toBe(true);
      expect(history[0].sessionId).not.toBe(originalSessionId);
    });

    it('keeps real conversation history when recreating after messages exist', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      manager.markActiveConversationHasMessages(mind.mindId, 'Hello Q');

      await manager.recreateSession(mind.mindId);

      const history = manager.listConversationHistory(mind.mindId);
      expect(history).toHaveLength(2);
      expect(history[0].active).toBe(true);
      expect(history[0].title).toMatch(/^New chat · /);
      expect(history[1].title).toBe('Hello Q');
    });

    it('recovers a real active conversation by resuming the same session id', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      manager.markActiveConversationHasMessages(mind.mindId, 'Hello Q');
      mockCreateSession.mockClear();
      mockResumeSession.mockClear();

      await manager.recoverActiveConversationSession(mind.mindId);

      expect(mockCreateSession).not.toHaveBeenCalled();
      expect(mockResumeSession).toHaveBeenCalledWith(
        mind.activeSessionId,
        expect.objectContaining({ workingDirectory: '/tmp/agents/q' }),
      );
      expect(manager.getMind(mind.mindId)?.activeSessionId).toBe(mind.activeSessionId);
      const history = manager.listConversationHistory(mind.mindId);
      expect(history).toHaveLength(1);
      expect(history[0].title).toBe('Hello Q');
      expect(history[0].active).toBe(true);
    });

    it('recovery resume re-attaches under the same Chamber session id when the SDK forgot the runtime', async () => {
      const reattachedSession = createSessionStub();
      const mind = await manager.loadMind('/tmp/agents/q');
      manager.markActiveConversationHasMessages(mind.mindId, 'Hello Q');
      mockCreateSession.mockClear();
      mockResumeSession.mockRejectedValueOnce(new Error('failed to resume session: Session not found: stale-session'));
      mockCreateSession.mockResolvedValueOnce(reattachedSession);

      const recovered = await manager.recoverActiveConversationSession(mind.mindId);

      expect(recovered).toBe(reattachedSession);
      expect(mockResumeSession).toHaveBeenCalledWith(
        mind.activeSessionId,
        expect.objectContaining({ workingDirectory: '/tmp/agents/q' }),
      );
      expect(mockCreateSession).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: mind.activeSessionId,
      }));
      expect(manager.getMind(mind.mindId)?.activeSessionId).toBe(mind.activeSessionId);
      const history = manager.listConversationHistory(mind.mindId);
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        sessionId: mind.activeSessionId,
        title: 'Hello Q',
        active: true,
      });
    });

    it('recovery surfaces stale errors when reattach also fails', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      manager.markActiveConversationHasMessages(mind.mindId, 'Hello Q');
      mockCreateSession.mockClear();
      mockResumeSession.mockRejectedValueOnce(new Error('Session not found: stale-1'));
      mockCreateSession.mockRejectedValueOnce(new Error('Session not found: stale-2'));

      await expect(manager.recoverActiveConversationSession(mind.mindId)).rejects.toThrow(/Session not found/);
      expect(manager.getMind(mind.mindId)?.activeSessionId).toBe(mind.activeSessionId);
    });

    it('recovers an empty active draft by replacing it with a new session id', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      const originalSessionId = mind.activeSessionId;

      await manager.recoverActiveConversationSession(mind.mindId);

      const history = manager.listConversationHistory(mind.mindId);
      expect(history).toHaveLength(1);
      expect(history[0].sessionId).not.toBe(originalSessionId);
      expect(history[0].title).toMatch(/^New chat · /);
      expect(history[0].active).toBe(true);
    });

    it('startNewConversation reuses the active empty conversation', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      const activeSessionId = mind.activeSessionId;

      await manager.startNewConversation(mind.mindId);

      expect(mockCreateSession).toHaveBeenCalledTimes(1);
      expect(manager.getMind(mind.mindId)?.activeSessionId).toBe(activeSessionId);
      expect(manager.listConversationHistory(mind.mindId)).toHaveLength(1);
    });

    it('startNewConversation creates one new active conversation after the current conversation has messages', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      manager.markActiveConversationHasMessages(mind.mindId, 'Hello Q');

      await manager.startNewConversation(mind.mindId);

      expect(mockCreateSession).toHaveBeenCalledTimes(2);
      const history = manager.listConversationHistory(mind.mindId);
      expect(history).toHaveLength(2);
      expect(history[0].active).toBe(true);
      expect(history[0].title).toMatch(/^New chat · /);
      expect(history[1].title).toBe('Hello Q');
    });

    it('throws for non-existent mind', async () => {
      await expect(manager.recreateSession('nonexistent')).rejects.toThrow();
    });
  });

  describe('conversation history', () => {
    it('resumes a selected conversation and hydrates messages from the SDK session', async () => {
      const resumedSession = createSessionStub();
      resumedSession.getEvents.mockResolvedValue([
        {
          type: 'user.message',
          timestamp: '2026-05-05T22:00:00.000Z',
          data: { messageId: 'u1', content: 'hello Monica' },
        },
        {
          type: 'assistant.message',
          timestamp: '2026-05-05T22:00:01.000Z',
          data: { messageId: 'a1', content: 'hello human' },
        },
      ]);
      mockResumeSession.mockResolvedValueOnce(resumedSession);
      const mind = await manager.loadMind('/tmp/agents/q');
      manager.markActiveConversationHasMessages(mind.mindId, 'Existing chat');
      await manager.recreateSession(mind.mindId);
      const historyBeforeResume = manager.listConversationHistory(mind.mindId);
      const target = historyBeforeResume[1];

      const result = await manager.resumeConversation(mind.mindId, target.sessionId);

      expect(mockResumeSession).toHaveBeenCalledWith(
        target.sessionId,
        expect.objectContaining({ workingDirectory: '/tmp/agents/q' }),
      );
      expect(result.sessionId).toBe(target.sessionId);
      expect(result.messages).toEqual([
        {
          id: 'u1',
          role: 'user',
          blocks: [{ type: 'text', content: 'hello Monica' }],
          timestamp: Date.parse('2026-05-05T22:00:00.000Z'),
        },
        {
          id: 'a1',
          role: 'assistant',
          blocks: [{ type: 'text', content: 'hello human' }],
          timestamp: Date.parse('2026-05-05T22:00:01.000Z'),
        },
      ]);
      expect(result.conversations.find((conversation) => conversation.sessionId === target.sessionId)?.active).toBe(true);
      expect(result.conversations.map((conversation) => conversation.sessionId)).toEqual(
        historyBeforeResume.map((conversation) => conversation.sessionId),
      );
    });

    it('wires approveForSessionCompat on resumed sessions and does not short-circuit via setApproveAll (issue #131)', async () => {
      const resumedSession = createSessionStub();
      resumedSession.getEvents.mockResolvedValue([]);
      mockResumeSession.mockResolvedValueOnce(resumedSession);
      const mind = await manager.loadMind('/tmp/agents/q');
      manager.markActiveConversationHasMessages(mind.mindId, 'Prior chat');
      await manager.recreateSession(mind.mindId);
      const target = manager.listConversationHistory(mind.mindId)[1];

      await manager.resumeConversation(mind.mindId, target.sessionId);

      const resumeConfig = mockResumeSession.mock.calls[0][1] as { onPermissionRequest?: unknown };
      expect(resumeConfig.onPermissionRequest).toBe(approveForSessionCompat);
      expect(resumedSession.rpc.permissions.setApproveAll).not.toHaveBeenCalled();
    });

    it('hydrates the already-active conversation without resuming the SDK session again', async () => {
      const activeSession = createSessionStub();
      activeSession.getEvents.mockResolvedValue([
        {
          type: 'user.message',
          timestamp: '2026-05-05T22:00:00.000Z',
          data: { messageId: 'u1', content: 'already active' },
        },
      ]);
      mockCreateSession.mockResolvedValueOnce(activeSession);
      const mind = await manager.loadMind('/tmp/agents/q');
      expect(mind.activeSessionId).toBeDefined();
      const activeSessionId = mind.activeSessionId!;
      manager.markActiveConversationHasMessages(mind.mindId, 'Already active');
      mockResumeSession.mockClear();

      const result = await manager.resumeConversation(mind.mindId, activeSessionId);

      expect(mockResumeSession).not.toHaveBeenCalled();
      expect(activeSession.disconnect).not.toHaveBeenCalled();
      expect(result.sessionId).toBe(activeSessionId);
      expect(result.messages).toEqual([
        {
          id: 'u1',
          role: 'user',
          blocks: [{ type: 'text', content: 'already active' }],
          timestamp: Date.parse('2026-05-05T22:00:00.000Z'),
        },
      ]);
      expect(result.conversations.find((conversation) => conversation.sessionId === activeSessionId)?.active).toBe(true);
    });

    it('deletes an inactive conversation without changing the active conversation', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      manager.markActiveConversationHasMessages(mind.mindId, 'First chat');
      await manager.startNewConversation(mind.mindId);
      const activeSessionId = manager.getMind(mind.mindId)?.activeSessionId;
      const inactive = manager.listConversationHistory(mind.mindId).find((conversation) => !conversation.active);
      expect(inactive).toBeDefined();

      const result = await manager.deleteConversation(mind.mindId, inactive!.sessionId);

      expect(result.sessionId).toBe(activeSessionId);
      expect(mockDeleteSession).toHaveBeenCalledWith(inactive!.sessionId);
      expect(manager.getMind(mind.mindId)?.activeSessionId).toBe(activeSessionId);
      expect(result.conversations).toHaveLength(1);
      expect(result.conversations[0]).toMatchObject({
        sessionId: activeSessionId,
        active: true,
      });
    });

    it('deletes the active conversation and hydrates the next most recent conversation', async () => {
      const resumedSession = createSessionStub();
      resumedSession.getEvents.mockResolvedValue([
        {
          type: 'user.message',
          timestamp: '2026-05-05T22:00:00.000Z',
          data: { messageId: 'u1', content: 'first chat' },
        },
      ]);
      const mind = await manager.loadMind('/tmp/agents/q');
      const firstSessionId = mind.activeSessionId;
      manager.markActiveConversationHasMessages(mind.mindId, 'First chat');
      await manager.startNewConversation(mind.mindId);
      const activeDraftId = manager.getMind(mind.mindId)?.activeSessionId;
      mockResumeSession.mockResolvedValueOnce(resumedSession);

      const result = await manager.deleteConversation(mind.mindId, activeDraftId!);

      expect(mockResumeSession).toHaveBeenCalledWith(firstSessionId, expect.objectContaining({ workingDirectory: '/tmp/agents/q' }));
      expect(mockDeleteSession).toHaveBeenCalledWith(activeDraftId);
      expect(result.sessionId).toBe(firstSessionId);
      expect(result.messages).toEqual([
        {
          id: 'u1',
          role: 'user',
          blocks: [{ type: 'text', content: 'first chat' }],
          timestamp: Date.parse('2026-05-05T22:00:00.000Z'),
        },
      ]);
      expect(result.conversations).toHaveLength(1);
      expect(result.conversations[0]).toMatchObject({
        sessionId: firstSessionId,
        title: 'First chat',
        active: true,
      });
    });

    it('deletes the last conversation and creates exactly one empty draft', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      const originalSessionId = mind.activeSessionId;

      const result = await manager.deleteConversation(mind.mindId, originalSessionId!);

      expect(result.messages).toEqual([]);
      expect(mockDeleteSession).toHaveBeenCalledWith(originalSessionId);
      expect(result.conversations).toHaveLength(1);
      expect(result.conversations[0].sessionId).not.toBe(originalSessionId);
      expect(result.conversations[0]).toMatchObject({
        active: true,
        hasMessages: false,
      });
      expect(manager.getMind(mind.mindId)?.activeSessionId).toBe(result.conversations[0].sessionId);
    });

    it('strips Chamber-injected datetime context from hydrated user messages', async () => {
      const resumedSession = createSessionStub();
      resumedSession.getEvents.mockResolvedValue([
        {
          type: 'user.message',
          timestamp: '2026-05-05T22:00:00.000Z',
          data: {
            messageId: 'u1',
            content: '<current_datetime>\n2026-05-07T03:19:51.220Z\n</current_datetime>\n<timezone>\nAmerica/New_York\n</timezone>\n\nyou should add another comment to the gh issue 125',
          },
        },
      ]);
      mockResumeSession.mockResolvedValueOnce(resumedSession);
      const mind = await manager.loadMind('/tmp/agents/q');
      manager.markActiveConversationHasMessages(mind.mindId, 'Existing chat');
      await manager.startNewConversation(mind.mindId);
      const target = manager.listConversationHistory(mind.mindId)[1];

      const result = await manager.resumeConversation(mind.mindId, target.sessionId);

      expect(result.messages[0]).toMatchObject({
        role: 'user',
        blocks: [{ type: 'text', content: 'you should add another comment to the gh issue 125' }],
      });
    });

    it('renames only Chamber-owned conversation metadata', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      const sessionId = manager.listConversationHistory(mind.mindId)[0].sessionId;

      const history = manager.renameConversation(mind.mindId, sessionId, 'Better title');

      expect(history[0]).toMatchObject({ sessionId, title: 'Better title' });
      expect(lastSavedConfig().minds[0].conversations?.[0]).toMatchObject({
        sessionId,
        title: 'Better title',
      });
    });
  });

  describe('restoreFromConfig', () => {
    it('loads all minds from config on startup', async () => {
      mockConfigService.load.mockReturnValue({
        version: 2,
        minds: [
          { id: 'q-a1b2', path: '/tmp/agents/q' },
          { id: 'fox-c3d4', path: '/tmp/agents/fox' },
        ],
        activeMindId: 'q-a1b2',
        activeLogin: 'alice',
        theme: 'dark',
      });

      await manager.restoreFromConfig();
      expect(manager.listMinds()).toHaveLength(2);
    });

    it('skips invalid paths without blocking others', async () => {
      vi.mocked(fs.existsSync).mockImplementation((p: fs.PathLike) => {
        const normalized = String(p).replace(/\\/g, '/');
        return normalized === '/tmp/agents/good/SOUL.md' || normalized === '/tmp/agents/good/.github';
      });

      mockConfigService.load.mockReturnValue({
        version: 2,
        minds: [
          { id: 'good-a1b2', path: '/tmp/agents/good' },
          { id: 'bad-c3d4', path: '/tmp/agents/bad' },
        ],
        activeMindId: 'good-a1b2',
        activeLogin: 'alice',
        theme: 'dark',
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(vi.fn());
      await manager.restoreFromConfig();
      expect(manager.listMinds()).toHaveLength(1);
      expect(manager.listMinds()[0].identity.name).toBe('good');
      consoleSpy.mockRestore();
    });

    it('preserves failed restore records when shutdown persists config', async () => {
      vi.mocked(fs.existsSync).mockImplementation((p: fs.PathLike) => {
        const normalized = String(p).replace(/\\/g, '/');
        return normalized === '/tmp/agents/good/SOUL.md' || normalized === '/tmp/agents/good/.github';
      });
      mockConfigService.load.mockReturnValue({
        version: 2,
        minds: [
          { id: 'good-a1b2', path: '/tmp/agents/good' },
          { id: 'bad-c3d4', path: '/tmp/agents/bad' },
        ],
        activeMindId: 'good-a1b2',
        activeLogin: 'alice',
        theme: 'dark',
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(vi.fn());
      await manager.restoreFromConfig();
      mockConfigService.save.mockClear();
      await manager.shutdown();

      expect(savedMindIds(lastSavedConfig())).toEqual(['bad-c3d4', 'good-a1b2']);
      consoleSpy.mockRestore();
    });

    it('preserves activeMindId when the active mind fails to restore', async () => {
      vi.mocked(fs.existsSync).mockImplementation((p: fs.PathLike) => {
        const normalized = String(p).replace(/\\/g, '/');
        return normalized === '/tmp/agents/good/SOUL.md' || normalized === '/tmp/agents/good/.github';
      });
      mockConfigService.load.mockReturnValue({
        version: 2,
        minds: [
          { id: 'bad-c3d4', path: '/tmp/agents/bad' },
          { id: 'good-a1b2', path: '/tmp/agents/good' },
        ],
        activeMindId: 'bad-c3d4',
        activeLogin: 'alice',
        theme: 'dark',
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(vi.fn());
      await manager.restoreFromConfig();
      expect(manager.getActiveMindId()).toBe('good-a1b2');
      mockConfigService.save.mockClear();
      await manager.shutdown();

      expect(lastSavedConfig().activeMindId).toBe('bad-c3d4');
      consoleSpy.mockRestore();
    });

    it('preserves every configured mind when all restores fail', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      mockConfigService.load.mockReturnValue({
        version: 2,
        minds: [
          { id: 'q-a1b2', path: '/tmp/agents/q' },
          { id: 'fox-c3d4', path: '/tmp/agents/fox' },
        ],
        activeMindId: 'q-a1b2',
        activeLogin: 'alice',
        theme: 'dark',
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(vi.fn());
      await manager.restoreFromConfig();
      mockConfigService.save.mockClear();
      await manager.shutdown();

      const config = lastSavedConfig();
      expect(savedMindIds(config)).toEqual(['fox-c3d4', 'q-a1b2']);
      expect(config.activeMindId).toBe('q-a1b2');
      consoleSpy.mockRestore();
    });

    it('handles empty config gracefully', async () => {
      mockConfigService.load.mockReturnValue({
        version: 2, minds: [], activeMindId: null, activeLogin: null, theme: 'dark',
      });

      await manager.restoreFromConfig();
      expect(manager.listMinds()).toHaveLength(0);
    });
  });

  describe('shutdown', () => {
    it('unloads all minds', async () => {
      await manager.loadMind('/tmp/agents/q');
      await manager.loadMind('/tmp/agents/fox');
      await manager.shutdown();
      expect(manager.listMinds()).toHaveLength(0);
      expect(mockClientFactory.destroyClient).toHaveBeenCalledTimes(2);
    });

    it('is idempotent', async () => {
      await manager.loadMind('/tmp/agents/q');
      await manager.shutdown();
      await expect(manager.shutdown()).resolves.not.toThrow();
    });
  });

  describe('event isolation', () => {
    it('creates separate sessions for different minds', async () => {
      await manager.loadMind('/tmp/agents/q');
      await manager.loadMind('/tmp/agents/fox');
      expect(mockCreateSession).toHaveBeenCalledTimes(2);
    });
  });

  describe('awaitRestore', () => {
    it('resolves after restoreFromConfig completes', async () => {
      mockConfigService.load.mockReturnValue({
        version: 2,
        minds: [{ id: 'q-a1b2', path: '/tmp/agents/q' }],
        activeMindId: 'q-a1b2',
        activeLogin: 'alice',
        theme: 'dark',
      });

      // Start restore (don't await it yet)
      const restorePromise = manager.restoreFromConfig();
      // awaitRestore should resolve once restore finishes
      await manager.awaitRestore();
      await restorePromise;
      expect(manager.listMinds()).toHaveLength(1);
    });

    it('resolves immediately when called before restoreFromConfig', async () => {
      // No restoreFromConfig called — should resolve without error
      await expect(manager.awaitRestore()).resolves.toBeUndefined();
    });

    it('can be called multiple times', async () => {
      mockConfigService.load.mockReturnValue({
        version: 2,
        minds: [{ id: 'q-a1b2', path: '/tmp/agents/q' }],
        activeMindId: 'q-a1b2',
        activeLogin: 'alice',
        theme: 'dark',
      });

      await manager.restoreFromConfig();
      await manager.awaitRestore();
      await manager.awaitRestore();
      expect(manager.listMinds()).toHaveLength(1);
    });
  });

  describe('restoreFromConfig ID preservation', () => {
    it('uses persisted IDs instead of generating new ones', async () => {
      mockConfigService.load.mockReturnValue({
        version: 2,
        minds: [{ id: 'my-stable-id', path: '/tmp/agents/q' }],
        activeMindId: 'my-stable-id',
        activeLogin: 'alice',
        theme: 'dark',
      });

      await manager.restoreFromConfig();
      const minds = manager.listMinds();
      expect(minds).toHaveLength(1);
      expect(minds[0].mindId).toBe('my-stable-id');
    });
  });

  describe('createTaskSession', () => {
    it('returns a session object', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      const session = await manager.createTaskSession(mind.mindId, 'task-1');
      expect(session).toBeDefined();
      expect(session).toHaveProperty('send');
    });

    it('uses same client as primary session (createSession called on same client)', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      mockCreateSession.mockClear();
      await manager.createTaskSession(mind.mindId, 'task-1');
      // createSession is on the same mock client — called once more for the task session
      expect(mockCreateSession).toHaveBeenCalledTimes(1);
    });

    it('throws for unknown mindId', async () => {
      await expect(manager.createTaskSession('nonexistent', 'task-1')).rejects.toThrow(
        'Mind nonexistent not found',
      );
    });

    it('calls createSession with correct identity (systemMessage matches)', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      mockCreateSession.mockClear();
      await manager.createTaskSession(mind.mindId, 'task-1');
      expect(mockCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          systemMessage: expect.objectContaining({
            mode: 'customize',
            sections: expect.objectContaining({
              identity: { action: 'replace', content: 'Identity for /tmp/agents/q' },
              tone: { action: 'remove' },
            }),
          }),
        }),
      );
    });

    it('includes provider tools in task sessions', async () => {
      const providerTool = {
        name: 'provider_tool',
        description: 'Provided tool',
        parameters: { type: 'object', properties: {} },
        handler: vi.fn(async () => null),
      };
      mockProvider.getToolsForMind.mockReturnValue([providerTool]);
      const mind = await manager.loadMind('/tmp/agents/q');
      mockCreateSession.mockClear();

      await manager.createTaskSession(mind.mindId, 'task-1');

      expect(mockCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: expect.arrayContaining([providerTool]),
        }),
      );
    });

    it('does not enable ask_user for task sessions without a user input handler', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      mockCreateSession.mockClear();

      await manager.createTaskSession(mind.mindId, 'task-1');

      const callArg = mockCreateSession.mock.calls[0]?.[0];
      expect(callArg).toBeDefined();
      expect(callArg).not.toHaveProperty('onUserInputRequest');
    });

    it('accepts custom onUserInputRequest callback', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      // New SDK UserInputHandler signature: (request: UserInputRequest, invocation) => UserInputResponse
      const customCallback = vi.fn(async () => ({
        answer: 'custom',
        wasFreeform: false,
      }));
      mockCreateSession.mockClear();

      await manager.createTaskSession(mind.mindId, 'task-1', customCallback);

      const callArg = mockCreateSession.mock.calls[0]?.[0];
      expect(callArg).toBeDefined();
      expect((callArg as { onUserInputRequest: unknown }).onUserInputRequest).toBe(customCallback);
    });
  });

  describe('concurrent loadMind guard', () => {
    it('returns same promise for concurrent calls with same path', async () => {
      const promise1 = manager.loadMind('/tmp/agents/q');
      const promise2 = manager.loadMind('/tmp/agents/q');
      const [mind1, mind2] = await Promise.all([promise1, promise2]);
      expect(mind1.mindId).toBe(mind2.mindId);
      expect(mockClientFactory.createClient).toHaveBeenCalledTimes(1);
    });
  });

  describe('mcp.json discovery (#199)', () => {
    it('passes parsed mcpServers to createSession when .mcp.json is present', async () => {
      const mcpJson = JSON.stringify({
        mcpServers: {
          memory: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-memory'],
            env: { ROOT: '/tmp/mem' },
          },
        },
      });
      vi.mocked(fs.existsSync).mockImplementation(() => true);
      vi.mocked(fs.readFileSync).mockImplementation((candidate) => {
        return String(candidate).endsWith('.mcp.json')
          ? mcpJson
          : '# TestAgent\nSome content';
      });

      await manager.loadMind('/tmp/agents/q');

      expect(mockCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpServers: {
            memory: {
              type: 'stdio',
              command: 'npx',
              args: ['-y', '@modelcontextprotocol/server-memory'],
              env: { ROOT: '/tmp/mem' },
              tools: ['*'],
            },
          },
        }),
      );
    });

    it('omits mcpServers from session config when .mcp.json is absent', async () => {
      // Default beforeEach: existsSync returns false for `.mcp.json`.
      await manager.loadMind('/tmp/agents/q');

      const config = mockCreateSession.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
      expect(config).toBeDefined();
      expect(Object.prototype.hasOwnProperty.call(config, 'mcpServers')).toBe(false);
    });
  });

  describe('managed skill discovery', () => {
    it('passes the mind skill parent directory to createSession', async () => {
      await manager.loadMind('/tmp/agents/q');

      expect(mockCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          skillDirectories: [path.join('/tmp/agents/q', '.github', 'skills')],
        }),
      );
    });

    it('passes the mind skill parent directory to resumeSession', async () => {
      const resumedSession = createSessionStub();
      resumedSession.getEvents.mockResolvedValue([]);
      mockResumeSession.mockResolvedValueOnce(resumedSession);
      const mind = await manager.loadMind('/tmp/agents/q');
      manager.markActiveConversationHasMessages(mind.mindId, 'Prior chat');
      await manager.recreateSession(mind.mindId);
      const target = manager.listConversationHistory(mind.mindId)[1];

      await manager.resumeConversation(mind.mindId, target.sessionId);

      expect(mockResumeSession).toHaveBeenCalledWith(
        target.sessionId,
        expect.objectContaining({
          skillDirectories: [path.join('/tmp/agents/q', '.github', 'skills')],
        }),
      );
    });
  });

  describe('chamber mind config (#131 — per-mind excludedTools)', () => {
    it('passes excludedTools through to createSession when .chamber.json declares them', async () => {
      const chamberJson = JSON.stringify({ excludedTools: ['shell', 'str_replace'] });
      vi.mocked(fs.existsSync).mockImplementation(() => true);
      vi.mocked(fs.readFileSync).mockImplementation((candidate) => {
        return String(candidate).endsWith('.chamber.json')
          ? chamberJson
          : '# TestAgent\nSome content';
      });

      await manager.loadMind('/tmp/agents/q');

      expect(mockCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          excludedTools: ['shell', 'str_replace'],
        }),
      );
    });

    it('omits excludedTools from session config when .chamber.json is absent', async () => {
      await manager.loadMind('/tmp/agents/q');

      const config = mockCreateSession.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
      expect(config).toBeDefined();
      expect(Object.prototype.hasOwnProperty.call(config, 'excludedTools')).toBe(false);
    });

    it('omits excludedTools from session config when .chamber.json declares an empty array', async () => {
      const chamberJson = JSON.stringify({ excludedTools: [] });
      vi.mocked(fs.existsSync).mockImplementation(() => true);
      vi.mocked(fs.readFileSync).mockImplementation((candidate) => {
        return String(candidate).endsWith('.chamber.json')
          ? chamberJson
          : '# TestAgent\nSome content';
      });

      await manager.loadMind('/tmp/agents/q');

      const config = mockCreateSession.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
      expect(config).toBeDefined();
      expect(Object.prototype.hasOwnProperty.call(config, 'excludedTools')).toBe(false);
    });

    it('passes excludedTools through to resumeSession when resuming a prior conversation', async () => {
      const chamberJson = JSON.stringify({ excludedTools: ['shell'] });
      vi.mocked(fs.existsSync).mockImplementation(() => true);
      vi.mocked(fs.readFileSync).mockImplementation((candidate) => {
        return String(candidate).endsWith('.chamber.json')
          ? chamberJson
          : '# TestAgent\nSome content';
      });
      const resumedSession = createSessionStub();
      resumedSession.getEvents.mockResolvedValue([]);
      mockResumeSession.mockResolvedValueOnce(resumedSession);
      const mind = await manager.loadMind('/tmp/agents/q');
      manager.markActiveConversationHasMessages(mind.mindId, 'Prior chat');
      await manager.recreateSession(mind.mindId);
      const target = manager.listConversationHistory(mind.mindId)[1];

      await manager.resumeConversation(mind.mindId, target.sessionId);

      const resumeConfig = mockResumeSession.mock.calls[0][1] as Record<string, unknown>;
      expect(resumeConfig.excludedTools).toEqual(['shell']);
    });
  });

  describe('provider integration', () => {
    it('activates providers after creating a mind session', async () => {
      await manager.loadMind('/tmp/agents/q');
      expect(mockProvider.activateMind).toHaveBeenCalledWith(
        expect.stringMatching(/^q-/),
        '/tmp/agents/q',
      );
      expect(mockCreateSession).toHaveBeenCalledTimes(1);
    });

    it('passes provider tools to createSessionForMind during load', async () => {
      const providerTool = {
        name: 'provider_tool',
        description: 'Provided tool',
        parameters: { type: 'object', properties: {} },
        handler: vi.fn(async () => null),
      };
      mockProvider.getToolsForMind.mockReturnValue([providerTool]);

      await manager.loadMind('/tmp/agents/q');

      expect(mockCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: expect.arrayContaining([providerTool]),
        }),
      );
    });

    it('recreateSession() rebuilds tools from providers', async () => {
      const providerTool = {
        name: 'fresh_tool',
        description: 'Fresh tool',
        parameters: { type: 'object', properties: {} },
        handler: vi.fn(async () => null),
      };
      mockProvider.getToolsForMind.mockReturnValue([providerTool]);
      const mind = await manager.loadMind('/tmp/agents/q');
      mockCreateSession.mockClear();

      await manager.recreateSession(mind.mindId);

      expect(mockProvider.getToolsForMind).toHaveBeenCalledWith(mind.mindId, '/tmp/agents/q');
      expect(mockCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: expect.arrayContaining([providerTool]),
        }),
      );
    });

    it('works without providers', async () => {
      const mgr = new MindManager(
        mockClientFactory as unknown as CopilotClientFactory,
        mockIdentityLoader as unknown as IdentityLoader,
        mockConfigService as unknown as ConfigService,
        mockViewDiscovery as unknown as ViewDiscovery,
      );

      await mgr.loadMind('/tmp/agents/q');

      expect(mockCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: [],
        }),
      );
    });
  });

  describe('reloadAllMinds', () => {
    it('unloads every loaded mind and restores them from config', async () => {
      await manager.loadMind('/tmp/agents/q');
      await manager.loadMind('/tmp/agents/fox');

      await manager.reloadAllMinds();

      expect(mockClientFactory.destroyClient).toHaveBeenCalledTimes(2);
      expect(manager.listMinds()).toHaveLength(2);
    });

    it('preserves activeMindId', async () => {
      const firstMind = await manager.loadMind('/tmp/agents/q');
      const secondMind = await manager.loadMind('/tmp/agents/fox');
      manager.setActiveMind(secondMind.mindId);

      await manager.reloadAllMinds();

      expect(manager.getActiveMindId()).toBe(secondMind.mindId);
      expect(manager.getActiveMindId()).not.toBe(firstMind.mindId);
    });

    it('creates fresh client instances after reload', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      const originalClient = manager.getMind(mind.mindId)?.client;

      await manager.reloadAllMinds();

      const reloadedClient = manager.getMind(mind.mindId)?.client;
      expect(reloadedClient).toBeDefined();
      expect(reloadedClient).not.toBe(originalClient);
    });

    it('preserves activeLogin in persisted config snapshots', async () => {
      mockConfigService.load.mockReturnValue({
        version: 2,
        minds: [],
        activeMindId: null,
        activeLogin: 'alice',
        theme: 'dark',
      });
      await manager.loadMind('/tmp/agents/q');

      await manager.reloadAllMinds();

      expect(mockConfigService.save).toHaveBeenCalledWith(expect.objectContaining({
        activeLogin: 'alice',
      }));
    });

    it('suppresses per-mind config writes during reload — only the snapshot save is written', async () => {
      await manager.loadMind('/tmp/agents/q');
      await manager.loadMind('/tmp/agents/fox');
      mockConfigService.save.mockClear();

      await manager.reloadAllMinds();

      // One snapshot save before restore, then one per re-loaded mind (from loadMind's persistConfig).
      // The two unloadMind calls should NOT produce saves thanks to the reloading guard.
      const saveCalls = mockConfigService.save.mock.calls;
      // First save is the snapshot (contains both minds)
      expect(saveCalls[0][0].minds).toHaveLength(2);
      // No save should have an empty minds array (which would be the mid-unload state)
      const emptyMindsSaves = saveCalls.filter((call: unknown[]) => (call[0] as { minds: unknown[] }).minds.length === 0);
      expect(emptyMindsSaves).toHaveLength(0);
    });

    it('does not drop failed restore records during reload', async () => {
      vi.mocked(fs.existsSync).mockImplementation((p: fs.PathLike) => {
        const normalized = String(p).replace(/\\/g, '/');
        return normalized === '/tmp/agents/good/SOUL.md' || normalized === '/tmp/agents/good/.github';
      });
      mockConfigService.load.mockReturnValue({
        version: 2,
        minds: [
          { id: 'good-a1b2', path: '/tmp/agents/good' },
          { id: 'bad-c3d4', path: '/tmp/agents/bad' },
        ],
        activeMindId: 'bad-c3d4',
        activeLogin: 'alice',
        theme: 'dark',
      });
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(vi.fn());
      await manager.restoreFromConfig();
      mockConfigService.save.mockClear();

      await manager.reloadAllMinds();

      for (const [config] of mockConfigService.save.mock.calls as Array<[AppConfig]>) {
        expect(savedMindIds(config)).toEqual(['bad-c3d4', 'good-a1b2']);
      }
      consoleSpy.mockRestore();
    });
  });

  describe('enableDreamDaemon / disableDreamDaemon', () => {
    beforeEach(() => {
      vi.mocked(patchChamberMindConfig).mockReset();
      vi.mocked(rollbackToUnstructured).mockReset();
      vi.mocked(rollbackToUnstructured).mockResolvedValue({
        framesConverted: 0,
        legacyExisted: false,
        outcome: 'no-op-missing',
      });
    });

    it('enableDreamDaemon patches .chamber.json with consolidation.enabled=true and reloads the mind', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      const reloadSpy = vi.spyOn(manager, 'reloadMind');

      await manager.enableDreamDaemon(mind.mindId);

      expect(patchChamberMindConfig).toHaveBeenCalledWith('/tmp/agents/q', {
        workingMemory: { consolidation: { enabled: true } },
      });
      expect(reloadSpy).toHaveBeenCalledWith(mind.mindId);
    });

    it('disableDreamDaemon patches .chamber.json with consolidation.enabled=false and reloads the mind', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      const reloadSpy = vi.spyOn(manager, 'reloadMind');

      await manager.disableDreamDaemon(mind.mindId);

      expect(patchChamberMindConfig).toHaveBeenCalledWith('/tmp/agents/q', {
        workingMemory: { consolidation: { enabled: false } },
      });
      expect(reloadSpy).toHaveBeenCalledWith(mind.mindId);
    });

    it('enableDreamDaemon throws when the mind is not loaded', async () => {
      await expect(manager.enableDreamDaemon('does-not-exist')).rejects.toThrow(/not found/);
      expect(patchChamberMindConfig).not.toHaveBeenCalled();
    });

    it('disableDreamDaemon throws when the mind is not loaded', async () => {
      await expect(manager.disableDreamDaemon('does-not-exist')).rejects.toThrow(/not found/);
      expect(patchChamberMindConfig).not.toHaveBeenCalled();
    });

    it('enableDreamDaemon resolves to the reloaded MindContext', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      const result = await manager.enableDreamDaemon(mind.mindId);
      expect(result.mindId).toBe(mind.mindId);
      expect(result.mindPath).toBe('/tmp/agents/q');
    });

    it('serializes concurrent toggle calls for the same mindId', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');

      // Hold reloadMind open so the second call observes an in-flight toggle.
      let releaseReload: (() => void) | undefined;
      const reloadGate = new Promise<void>((resolve) => { releaseReload = resolve; });
      const reloadSpy = vi.spyOn(manager, 'reloadMind').mockImplementation(async () => {
        await reloadGate;
        // Return a synthetic context that mirrors the mind we created so
        // assertions on the resolved value remain meaningful.
        return { ...mind } as MindContext;
      });

      const first = manager.enableDreamDaemon(mind.mindId);
      const second = manager.enableDreamDaemon(mind.mindId);

      // Same in-flight promise must be returned to the second caller, so
      // patchChamberMindConfig fires exactly once for the pair.
      expect(second).toBe(first);

      releaseReload!();
      const [a, b] = await Promise.all([first, second]);
      expect(a).toBe(b);
      expect(reloadSpy).toHaveBeenCalledTimes(1);
      expect(patchChamberMindConfig).toHaveBeenCalledTimes(1);
    });

    it('disableDreamDaemon calls rollbackToUnstructured AFTER patch + reload', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      const callOrder: string[] = [];
      vi.mocked(patchChamberMindConfig).mockImplementation(() => { callOrder.push('patch'); });
      const reloadSpy = vi.spyOn(manager, 'reloadMind').mockImplementation(async () => {
        callOrder.push('reload');
        return { ...mind } as MindContext;
      });
      vi.mocked(rollbackToUnstructured).mockImplementation(async () => {
        callOrder.push('rollback');
        return { framesConverted: 2, legacyExisted: false, outcome: 'rolled-back' };
      });

      await manager.disableDreamDaemon(mind.mindId);

      expect(callOrder).toEqual(['patch', 'reload', 'rollback']);
      expect(rollbackToUnstructured).toHaveBeenCalledWith('/tmp/agents/q');
      expect(reloadSpy).toHaveBeenCalledWith(mind.mindId);
    });

    it('enableDreamDaemon does NOT call rollbackToUnstructured', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      await manager.enableDreamDaemon(mind.mindId);
      expect(rollbackToUnstructured).not.toHaveBeenCalled();
    });

    it('disableDreamDaemon resolves to the reloaded MindContext even when rollback fails', async () => {
      const mind = await manager.loadMind('/tmp/agents/q');
      vi.mocked(rollbackToUnstructured).mockRejectedValueOnce(new Error('rollback boom'));

      const result = await manager.disableDreamDaemon(mind.mindId);

      // Toggle is non-fatal: config has been flipped + reload completed.
      // A failed rollback only logs a warning; the user-visible toggle
      // succeeds so the UI state matches the on-disk config.
      expect(result.mindId).toBe(mind.mindId);
      expect(patchChamberMindConfig).toHaveBeenCalledWith('/tmp/agents/q', {
        workingMemory: { consolidation: { enabled: false } },
      });
    });

    describe('feature-flag gate (dreamDaemonFeatureEnabled)', () => {
      // Defense-in-depth: the IPC layer is the first line of defense, but
      // any internal caller (test harness, data migration, future helper)
      // must also be gated. Constructing a manager with `() => false`
      // exercises the gate inside `doToggleDreamDaemon` directly.
      const buildGatedManager = () => {
        const mgr = new MindManager(
          mockClientFactory as unknown as CopilotClientFactory,
          mockIdentityLoader as unknown as IdentityLoader,
          mockConfigService as unknown as ConfigService,
          mockViewDiscovery as unknown as ViewDiscovery,
          undefined,
          undefined,
          () => false,
        );
        mgr.setProviders([mockProvider as unknown as ChamberToolProvider]);
        return mgr;
      };

      it('enableDreamDaemon throws when the feature accessor returns false', async () => {
        const mgr = buildGatedManager();
        const mind = await mgr.loadMind('/tmp/agents/q');

        await expect(mgr.enableDreamDaemon(mind.mindId)).rejects.toThrow(
          /Dream Daemon is not available in this build/,
        );
        expect(patchChamberMindConfig).not.toHaveBeenCalled();
      });

      it('sequential enableDreamDaemon calls both reject when the feature is off', async () => {
        // Regression guard for the daemonToggling in-flight map: if a stale
        // allow ever leaked through, the SECOND call could silently resolve
        // without going through doToggleDreamDaemon. We need both to throw.
        const mgr = buildGatedManager();
        const mind = await mgr.loadMind('/tmp/agents/q');

        await expect(mgr.enableDreamDaemon(mind.mindId)).rejects.toThrow(
          /Dream Daemon is not available in this build/,
        );
        await expect(mgr.enableDreamDaemon(mind.mindId)).rejects.toThrow(
          /Dream Daemon is not available in this build/,
        );
        expect(patchChamberMindConfig).not.toHaveBeenCalled();
      });

      it('disableDreamDaemon is allowed even when the feature accessor returns false', async () => {
        // A stable build that picks up a mind enabled under insiders must
        // still be able to clean up the persisted opt-in. Only `enable` is
        // gated; `disable` is always permitted.
        const mgr = buildGatedManager();
        const mind = await mgr.loadMind('/tmp/agents/q');

        await mgr.disableDreamDaemon(mind.mindId);

        expect(patchChamberMindConfig).toHaveBeenCalledWith('/tmp/agents/q', {
          workingMemory: { consolidation: { enabled: false } },
        });
      });

      it('enableDreamDaemon proceeds when the feature accessor returns true', async () => {
        // Sanity check: explicit `() => true` matches the default-on
        // behavior the rest of the test file relies on.
        const mgr = new MindManager(
          mockClientFactory as unknown as CopilotClientFactory,
          mockIdentityLoader as unknown as IdentityLoader,
          mockConfigService as unknown as ConfigService,
          mockViewDiscovery as unknown as ViewDiscovery,
          undefined,
          undefined,
          () => true,
        );
        mgr.setProviders([mockProvider as unknown as ChamberToolProvider]);
        const mind = await mgr.loadMind('/tmp/agents/q');

        await mgr.enableDreamDaemon(mind.mindId);

        expect(patchChamberMindConfig).toHaveBeenCalledWith('/tmp/agents/q', {
          workingMemory: { consolidation: { enabled: true } },
        });
      });
    });
  });

  describe('BYO LLM provider config integration (SDK-native)', () => {
    it('BVT-MM01: passes provider into createSession only when a BYO model is selected', async () => {
      const provider = { type: 'openai' as const, baseUrl: 'https://example.com/v1', apiKey: 'lm-studio' };
      const byoProviderConfigProvider = vi.fn().mockReturnValue(provider);
      const byoDefaultModelProvider = vi.fn().mockReturnValue('gemma-4-e4b');
      currentConfig = {
        version: 2,
        minds: [{ id: 'q-a1b2', path: '/tmp/agents/q', selectedModel: 'gemma-4-e4b', selectedModelProvider: 'byo' }],
        activeMindId: 'q-a1b2',
        activeLogin: null,
        theme: 'dark',
      };
      const mgr = new MindManager(
        mockClientFactory as unknown as CopilotClientFactory,
        mockIdentityLoader as unknown as IdentityLoader,
        mockConfigService as unknown as ConfigService,
        mockViewDiscovery as unknown as ViewDiscovery,
        byoProviderConfigProvider,
        byoDefaultModelProvider,
      );

      await mgr.restoreFromConfig();

      expect(byoProviderConfigProvider).toHaveBeenCalled();
      // Client factory is called WITHOUT extraEnv now (provider is passed via session config)
      expect(mockClientFactory.createClient).toHaveBeenCalledWith('/tmp/agents/q');
      // Verify provider + model were passed into createSession
      const createSessionCall = mockCreateSession.mock.calls[mockCreateSession.mock.calls.length - 1]?.[0] as Record<string, unknown> | undefined;
      expect(createSessionCall?.provider).toEqual(provider);
      expect(createSessionCall?.model).toBe('gemma-4-e4b');
    });

    it('restores BYO-selected minds with the default provider when BYO is disabled', async () => {
      currentConfig = {
        version: 2,
        minds: [{ id: 'q-a1b2', path: '/tmp/agents/q', selectedModel: 'gemma-4-e4b', selectedModelProvider: 'byo' }],
        activeMindId: 'q-a1b2',
        activeLogin: null,
        theme: 'dark',
      };
      const mgr = new MindManager(
        mockClientFactory as unknown as CopilotClientFactory,
        mockIdentityLoader as unknown as IdentityLoader,
        mockConfigService as unknown as ConfigService,
        mockViewDiscovery as unknown as ViewDiscovery,
        () => null,
      );

      await mgr.restoreFromConfig();

      const createSessionCall = mockCreateSession.mock.calls[mockCreateSession.mock.calls.length - 1]?.[0] as Record<string, unknown> | undefined;
      expect(createSessionCall?.provider).toBeUndefined();
      expect(createSessionCall?.model).toBeUndefined();
      expect(mgr.listMinds()[0].selectedModel).toBeUndefined();
      expect(mgr.listMinds()[0].selectedModelProvider).toBeUndefined();
    });

    it('BVT-MM02: omits provider from createSession when BYO is enabled but no BYO model is selected', async () => {
      const byoProviderConfigProvider = vi.fn().mockReturnValue({ type: 'openai' as const, baseUrl: 'https://example.com/v1' });
      const byoDefaultModelProvider = vi.fn().mockReturnValue(undefined);
      const mgr = new MindManager(
        mockClientFactory as unknown as CopilotClientFactory,
        mockIdentityLoader as unknown as IdentityLoader,
        mockConfigService as unknown as ConfigService,
        mockViewDiscovery as unknown as ViewDiscovery,
        byoProviderConfigProvider,
        byoDefaultModelProvider,
      );

      await mgr.loadMind('/tmp/agents/q');

      const createSessionCall = mockCreateSession.mock.calls[mockCreateSession.mock.calls.length - 1]?.[0] as Record<string, unknown> | undefined;
      expect(createSessionCall?.provider).toBeUndefined();
      expect(createSessionCall?.model).toBeUndefined();
      expect(byoProviderConfigProvider).not.toHaveBeenCalled();
    });

    it('BVT-MM02b: rejects a BYO model selection when BYO provider config is unavailable', async () => {
      const byoProviderConfigProvider = vi.fn().mockReturnValue(null);
      const mgr = new MindManager(
        mockClientFactory as unknown as CopilotClientFactory,
        mockIdentityLoader as unknown as IdentityLoader,
        mockConfigService as unknown as ConfigService,
        mockViewDiscovery as unknown as ViewDiscovery,
        byoProviderConfigProvider,
      );
      const q = await mgr.loadMind('/tmp/agents/q');
      mockCreateSession.mockClear();

      await expect(mgr.setMindModel(q.mindId, 'byo:gemma-4-e4b')).rejects.toThrow(
        'BYO LLM model selected, but BYO LLM is not enabled or configured.',
      );

      expect(byoProviderConfigProvider).toHaveBeenCalled();
      expect(mockCreateSession).not.toHaveBeenCalled();
    });

    it('BVT-MM03: restartAllMindsForByoChange refreshes only BYO-selected loaded minds', async () => {
      const byoProviderConfigProvider = vi.fn().mockReturnValue({ type: 'openai' as const, baseUrl: 'https://x/v1' });
      const mgr = new MindManager(
        mockClientFactory as unknown as CopilotClientFactory,
        mockIdentityLoader as unknown as IdentityLoader,
        mockConfigService as unknown as ConfigService,
        mockViewDiscovery as unknown as ViewDiscovery,
        byoProviderConfigProvider,
      );

      const q = await mgr.loadMind('/tmp/agents/q');
      await mgr.loadMind('/tmp/agents/fox');
      await mgr.setMindModel(q.mindId, 'byo:gemma-4-e4b');
      mockClientFactory.destroyClient.mockClear();

      const result = await mgr.restartAllMindsForByoChange();

      expect(result).toEqual({ restartedCount: 1 });
      expect(mockClientFactory.destroyClient).toHaveBeenCalledTimes(1);
    });

    it('BVT-MM04: per-mind selectedModel takes precedence over BYO default', async () => {
      const provider = { type: 'openai' as const, baseUrl: 'https://x/v1' };
      const mgr = new MindManager(
        mockClientFactory as unknown as CopilotClientFactory,
        mockIdentityLoader as unknown as IdentityLoader,
        mockConfigService as unknown as ConfigService,
        mockViewDiscovery as unknown as ViewDiscovery,
        () => provider,
        () => 'gemma-4-e4b',
      );
      const resolved = (mgr as unknown as { resolveModelForSdk: (m: string | undefined, p: typeof provider) => string | undefined }).resolveModelForSdk('qwen3.5-9b', provider);
      expect(resolved).toBe('qwen3.5-9b');
    });

    it('BVT-MM05: BYO default model is used when per-mind selectedModel is undefined', async () => {
      const provider = { type: 'openai' as const, baseUrl: 'https://x/v1' };
      const mgr = new MindManager(
        mockClientFactory as unknown as CopilotClientFactory,
        mockIdentityLoader as unknown as IdentityLoader,
        mockConfigService as unknown as ConfigService,
        mockViewDiscovery as unknown as ViewDiscovery,
        () => provider,
        () => 'gemma-4-e4b',
      );
      const resolved = (mgr as unknown as { resolveModelForSdk: (m: string | undefined, p: typeof provider) => string | undefined }).resolveModelForSdk(undefined, provider);
      expect(resolved).toBe('gemma-4-e4b');
    });

    it('BVT-MM06: empty-string selectedModel falls back to BYO default', async () => {
      const provider = { type: 'openai' as const, baseUrl: 'https://x/v1' };
      const mgr = new MindManager(
        mockClientFactory as unknown as CopilotClientFactory,
        mockIdentityLoader as unknown as IdentityLoader,
        mockConfigService as unknown as ConfigService,
        mockViewDiscovery as unknown as ViewDiscovery,
        () => provider,
        () => 'gemma-4-e4b',
      );
      const resolved = (mgr as unknown as { resolveModelForSdk: (m: string | undefined, p: typeof provider) => string | undefined }).resolveModelForSdk('  ', provider);
      expect(resolved).toBe('gemma-4-e4b');
    });

    it('BVT-MM07: BYO default model is not used when provider is inactive', () => {
      const mgr = new MindManager(
        mockClientFactory as unknown as CopilotClientFactory,
        mockIdentityLoader as unknown as IdentityLoader,
        mockConfigService as unknown as ConfigService,
        mockViewDiscovery as unknown as ViewDiscovery,
        () => null,
        () => 'gemma-4-e4b',
      );
      const resolved = (mgr as unknown as { resolveModelForSdk: (m: string | undefined, p: null) => string | undefined }).resolveModelForSdk(undefined, null);
      expect(resolved).toBeUndefined();
    });

    it('BVT-MM08: cloud-to-BYO model switch recreates a provider-scoped session', async () => {
      const provider = { type: 'openai' as const, baseUrl: 'https://x/v1' };
      const mgr = new MindManager(
        mockClientFactory as unknown as CopilotClientFactory,
        mockIdentityLoader as unknown as IdentityLoader,
        mockConfigService as unknown as ConfigService,
        mockViewDiscovery as unknown as ViewDiscovery,
        () => provider,
        () => 'gemma-4-e4b',
      );

      const q = await mgr.loadMind('/tmp/agents/q');
      await mgr.setMindModel(q.mindId, 'claude-sonnet-4.6');
      const cloudSession = mgr.getMind(q.mindId)?.session as unknown as ReturnType<typeof createSessionStub>;
      mockCreateSession.mockClear();
      mockResumeSession.mockClear();

      const updated = await mgr.setMindModel(q.mindId, 'byo:gemma-4-e4b');

      expect(updated?.selectedModel).toBe('gemma-4-e4b');
      expect(updated?.selectedModelProvider).toBe('byo');
      expect(cloudSession.setModel).toHaveBeenCalledWith('claude-sonnet-4.6');
      expect(cloudSession.disconnect).toHaveBeenCalled();
      expect(mockResumeSession).not.toHaveBeenCalled();
      const createSessionConfig = mockCreateSession.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined;
      expect(createSessionConfig?.provider).toBe(provider);
      expect(createSessionConfig?.model).toBe('gemma-4-e4b');
      expect(lastSavedConfig().minds[0]).toMatchObject({
        selectedModel: 'gemma-4-e4b',
        selectedModelProvider: 'byo',
      });
    });

    it('BVT-MM09: BYO-to-cloud model switch recreates a cloud session without provider', async () => {
      const provider = { type: 'openai' as const, baseUrl: 'https://x/v1' };
      const mgr = new MindManager(
        mockClientFactory as unknown as CopilotClientFactory,
        mockIdentityLoader as unknown as IdentityLoader,
        mockConfigService as unknown as ConfigService,
        mockViewDiscovery as unknown as ViewDiscovery,
        () => provider,
        () => 'gemma-4-e4b',
      );

      const q = await mgr.loadMind('/tmp/agents/q');
      await mgr.setMindModel(q.mindId, 'byo:gemma-4-e4b');
      const byoSession = mgr.getMind(q.mindId)?.session as unknown as ReturnType<typeof createSessionStub>;
      mockCreateSession.mockClear();
      mockResumeSession.mockClear();

      const updated = await mgr.setMindModel(q.mindId, 'copilot:claude-sonnet-4.6');

      expect(updated?.selectedModel).toBe('claude-sonnet-4.6');
      expect(updated?.selectedModelProvider).toBeUndefined();
      expect(byoSession.setModel).not.toHaveBeenCalledWith('claude-sonnet-4.6');
      expect(byoSession.disconnect).toHaveBeenCalled();
      expect(mockResumeSession).not.toHaveBeenCalled();
      const createSessionConfig = mockCreateSession.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined;
      expect(createSessionConfig?.provider).toBeUndefined();
      expect(createSessionConfig?.model).toBe('claude-sonnet-4.6');
    });

    it('BVT-MM10: restartAllMindsForByoChange clears only BYO-selected models when BYO is disabled', async () => {
      const provider = { type: 'openai' as const, baseUrl: 'https://x/v1' };
      const mgr = new MindManager(
        mockClientFactory as unknown as CopilotClientFactory,
        mockIdentityLoader as unknown as IdentityLoader,
        mockConfigService as unknown as ConfigService,
        mockViewDiscovery as unknown as ViewDiscovery,
        () => provider,
      );

      const q = await mgr.loadMind('/tmp/agents/q');
      const fox = await mgr.loadMind('/tmp/agents/fox');
      await mgr.setMindModel(q.mindId, 'byo:google%2Fgemma-4-e4b');
      await mgr.setMindModel(fox.mindId, 'gpt-5.4');

      const result = await mgr.restartAllMindsForByoChange(null);

      expect(result).toEqual({ restartedCount: 1 });
      const qRecord = currentConfig.minds.find((mind) => mind.id === q.mindId);
      const foxRecord = currentConfig.minds.find((mind) => mind.id === fox.mindId);
      expect(qRecord?.selectedModel).toBeUndefined();
      expect(qRecord?.selectedModelProvider).toBeUndefined();
      expect(foxRecord?.selectedModel).toBe('gpt-5.4');
      expect(foxRecord?.selectedModelProvider).toBeUndefined();
    });
  });
});
