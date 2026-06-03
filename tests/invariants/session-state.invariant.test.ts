import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'node:path';
import { MindManager } from '../../packages/services/src/mind/MindManager';
import type { CopilotClientFactory } from '../../packages/services/src/sdk/CopilotClientFactory';
import type { IdentityLoader } from '../../packages/services/src/chat/IdentityLoader';
import type { ConfigService } from '../../packages/services/src/config/ConfigService';
import type { ViewDiscovery } from '../../packages/services/src/lens/ViewDiscovery';
import type { AppConfig } from '@chamber/shared/types';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(() => []),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  realpathSync: Object.assign(vi.fn((candidate: string) => candidate), {
    native: vi.fn((candidate: string) => candidate),
  }),
}));

vi.mock('../../packages/services/src/lens/MindBootstrap', () => ({
  bootstrapMindCapabilities: vi.fn(),
}));

import * as fs from 'fs';

const COPILOT_RUNTIME_CONFIG_DIR = path.join('C:\\tmp\\chamber-config', 'copilot-runtime');

let sessionCounter = 0;
function createSessionStub(sessionId = `sdk-session-${sessionCounter += 1}`) {
  return {
    sessionId,
    send: vi.fn(),
    sendAndWait: vi.fn(async () => ({
      type: 'assistant.message',
      data: { content: 'ok' },
    })),
    getEvents: vi.fn(async (): Promise<unknown[]> => []),
    on: vi.fn(),
    off: vi.fn(),
    disconnect: vi.fn(async () => undefined),
    setModel: vi.fn(async () => undefined),
    rpc: { permissions: { setApproveAll: vi.fn(async () => ({ success: true })) } },
  };
}

const mockCreateSession = vi.fn((config: Record<string, unknown>) =>
  createSessionStub(typeof config.sessionId === 'string' ? config.sessionId : undefined));
const mockResumeSession = vi.fn((sessionId: string, config: Record<string, unknown>) => {
  void config;
  return createSessionStub(sessionId);
});

const mockClientFactory = {
  createClient: vi.fn(async () => ({
    start: vi.fn(),
    stop: vi.fn(),
    createSession: mockCreateSession,
    resumeSession: mockResumeSession,
    deleteSession: vi.fn(async () => undefined),
  })),
  destroyClient: vi.fn(),
};

const mockIdentityLoader = {
  load: vi.fn((mindPath: string) => ({
    name: mindPath.split('/').pop() ?? 'unknown',
    systemMessage: `Identity for ${mindPath}`,
  })),
};

let currentConfig: AppConfig;
const mockConfigService = {
  getConfigDir: vi.fn(() => 'C:\\tmp\\chamber-config'),
  load: vi.fn(() => currentConfig),
  save: vi.fn((config: AppConfig) => {
    currentConfig = config;
  }),
};

const mockViewDiscovery = {
  scan: vi.fn(async () => []),
  getViews: vi.fn(() => []),
  startWatching: vi.fn(),
  stopWatching: vi.fn(),
  removeMind: vi.fn(),
  setRefreshHandler: vi.fn(),
};

function createManager(): MindManager {
  return new MindManager(
    mockClientFactory as unknown as CopilotClientFactory,
    mockIdentityLoader as unknown as IdentityLoader,
    mockConfigService as unknown as ConfigService,
    mockViewDiscovery as unknown as ViewDiscovery,
  );
}

describe('session-state invariants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionCounter = 0;
    currentConfig = {
      version: 2,
      minds: [],
      activeMindId: null,
      activeLogin: null,
      theme: 'dark',
    };
    mockCreateSession.mockImplementation((config: Record<string, unknown>) =>
      createSessionStub(typeof config.sessionId === 'string' ? config.sessionId : undefined));
    mockResumeSession.mockImplementation((sessionId: string, config: Record<string, unknown>) => {
      void config;
      return createSessionStub(sessionId);
    });
    vi.mocked(fs.existsSync).mockImplementation((candidate) => {
      const s = String(candidate);
      return !s.endsWith('.mcp.json') && !s.endsWith('.chamber.json');
    });
    vi.mocked(fs.readFileSync).mockReturnValue('# TestAgent\nSome content');
    vi.mocked(fs.realpathSync.native).mockImplementation((candidate) => String(candidate));
  });

  it('persisted conversations resume from Chamber state, then legacy state, before reattaching', async () => {
    const manager = createManager();
    const mind = await manager.loadMind('/tmp/agents/q');
    manager.markActiveConversationHasMessages(mind.mindId, 'Existing chat');
    await manager.startNewConversation(mind.mindId);
    const target = manager.listConversationHistory(mind.mindId)[1];
    const legacySession = createSessionStub(target.sessionId);
    legacySession.getEvents.mockResolvedValue([
      {
        type: 'user.message',
        timestamp: '2026-05-05T22:00:00.000Z',
        data: { messageId: 'u1', content: 'legacy chat' },
      },
    ]);
    mockCreateSession.mockClear();
    mockResumeSession
      .mockRejectedValueOnce(new Error('failed to resume session: Session not found: missing-runtime'))
      .mockResolvedValueOnce(legacySession);

    const result = await manager.resumeConversation(mind.mindId, target.sessionId);

    expect(mockResumeSession).toHaveBeenCalledTimes(2);
    expect(mockResumeSession).toHaveBeenNthCalledWith(
      1,
      target.sessionId,
      expect.objectContaining({
        configDir: COPILOT_RUNTIME_CONFIG_DIR,
        enableConfigDiscovery: false,
      }),
    );
    expect(mockResumeSession).toHaveBeenNthCalledWith(
      2,
      target.sessionId,
      expect.not.objectContaining({ configDir: expect.any(String) }),
    );
    expect(mockResumeSession.mock.calls[1][1]).toMatchObject({
      workingDirectory: '/tmp/agents/q',
      enableConfigDiscovery: false,
    });
    expect(mockCreateSession).not.toHaveBeenCalled();
    expect(result.messages).toEqual([
      {
        id: 'u1',
        role: 'user',
        blocks: [{ type: 'text', content: 'legacy chat' }],
        timestamp: Date.parse('2026-05-05T22:00:00.000Z'),
      },
    ]);
  });

  it('ephemeral sessions never reuse Chamber conversation session ids', async () => {
    const manager = createManager();
    const mind = await manager.loadMind('/tmp/agents/q');
    mockCreateSession.mockClear();

    await manager.createTaskSession(mind.mindId, 'task-1');
    await manager.createChatroomSession(mind.mindId);
    await manager.runIsolatedPrompt(mind.mindId, 'summarize');

    expect(mockCreateSession).toHaveBeenCalledTimes(3);
    for (const [config] of mockCreateSession.mock.calls) {
      expect(config).not.toHaveProperty('sessionId');
      expect(config).toMatchObject({
        configDir: COPILOT_RUNTIME_CONFIG_DIR,
        enableConfigDiscovery: false,
      });
    }
  });
});
