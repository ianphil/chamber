import { vi } from 'vitest';
import type {
  ChatMessage,
  ChatEvent,
  ContentBlock,
  TextBlock,
  ToolCallBlock,
  ReasoningBlock,
  ModelInfo,
  LensViewManifest,
  DesktopUpdateState,
} from '@chamber/shared/types';
import type { ElectronAPI } from '@chamber/shared/electron-types';
import type {
  ChatroomMessage,
} from '@chamber/shared/chatroom-types';

// ---------------------------------------------------------------------------
// ContentBlock factories
// ---------------------------------------------------------------------------

export function makeTextBlock(content: string, sdkMessageId?: string): TextBlock {
  return { type: 'text', content, ...(sdkMessageId && { sdkMessageId }) };
}

export function makeToolCallBlock(overrides?: Partial<ToolCallBlock>): ToolCallBlock {
  return {
    type: 'tool_call',
    toolCallId: 'tc-1',
    toolName: 'grep',
    status: 'running',
    ...overrides,
  };
}

export function makeReasoningBlock(content: string, reasoningId?: string): ReasoningBlock {
  return { type: 'reasoning', reasoningId: reasoningId ?? 'r-1', content };
}

// ---------------------------------------------------------------------------
// ChatMessage factory
// ---------------------------------------------------------------------------

export function makeMessage(blocks: ContentBlock[], overrides?: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'msg-1',
    role: 'assistant',
    blocks,
    timestamp: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ChatEvent factory
// ---------------------------------------------------------------------------

export function makeChatEvent<T extends ChatEvent['type']>(
  type: T,
  overrides?: Omit<Extract<ChatEvent, { type: T }>, 'type'>,
): Extract<ChatEvent, { type: T }> {
  const defaults: Record<string, Record<string, unknown>> = {
    chunk: { content: 'hello' },
    tool_start: { toolCallId: 'tc-1', toolName: 'grep' },
    tool_progress: { toolCallId: 'tc-1', message: 'progress' },
    tool_output: { toolCallId: 'tc-1', output: 'result' },
    tool_done: { toolCallId: 'tc-1', success: true },
    reasoning: { reasoningId: 'r-1', content: 'thinking' },
    message_final: { sdkMessageId: 'sdk-1', content: 'final' },
    permission_request: { requestId: 'pr-1', kind: 'shell', summary: 'git status' },
    permission_outcome: { requestId: 'pr-1', outcome: 'approved-for-session' },
    reconnecting: {},
    done: {},
    timeout: { timeoutMs: 30_000 },
    error: { message: 'something went wrong' },
  };
  return { type, ...defaults[type], ...overrides } as Extract<ChatEvent, { type: T }>;
}

// ---------------------------------------------------------------------------
// LensViewManifest factory
// ---------------------------------------------------------------------------

export function makeLensViewManifest(overrides?: Partial<LensViewManifest>): LensViewManifest {
  return {
    id: 'test-view',
    name: 'Test View',
    icon: 'layout',
    view: 'briefing',
    source: 'test.json',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ModelInfo factory
// ---------------------------------------------------------------------------

export function makeModelInfo(id = 'claude-sonnet', name = 'Claude Sonnet'): ModelInfo {
  return { id, name };
}

// ---------------------------------------------------------------------------
// ElectronAPI mock
// ---------------------------------------------------------------------------

export function mockElectronAPI(): ElectronAPI {
  return {
    chat: {
      send: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      newConversation: vi.fn().mockResolvedValue({ sessionId: '', messages: [], conversations: [] }),
      listModels: vi.fn().mockResolvedValue([]),
      getEventSequence: vi.fn().mockResolvedValue(0),
      replayEvents: vi.fn().mockResolvedValue([]),
      onEvent: vi.fn().mockReturnValue(vi.fn()),
    },
    conversationHistory: {
      list: vi.fn().mockResolvedValue([]),
      resume: vi.fn().mockResolvedValue({ sessionId: '', messages: [], conversations: [] }),
      rename: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue({ sessionId: '', messages: [], conversations: [] }),
    },
    mind: {
      add: vi.fn().mockResolvedValue({ mindId: 'test-1234', mindPath: 'C:\\test', identity: { name: 'Test', systemMessage: '' }, status: 'ready' }),
      remove: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue([]),
      setActive: vi.fn().mockResolvedValue(undefined),
      setModel: vi.fn().mockResolvedValue(null),
      selectDirectory: vi.fn().mockResolvedValue(null),
      openWindow: vi.fn().mockResolvedValue(undefined),
      onMindChanged: vi.fn().mockReturnValue(vi.fn()),
    },
    mindProfile: {
      get: vi.fn().mockImplementation((mindId: string) => Promise.resolve({
        mindId,
        mindPath: 'C:\\test',
        displayName: 'Test',
        folderName: 'test',
        avatarDataUrl: null,
        soul: { kind: 'soul', label: 'SOUL.md', relativePath: 'SOUL.md', content: '# Test\n', exists: true, mtimeMs: 1 },
        agentFiles: [{ kind: 'agent', label: 'test.agent.md', relativePath: '.github\\agents\\test.agent.md', content: '# Test agent\n', exists: true, mtimeMs: 2 }],
        needsRestart: false,
      })),
      saveFile: vi.fn().mockResolvedValue({ success: true, needsRestart: true, profile: {
        mindId: 'test-1234',
        mindPath: 'C:\\test',
        displayName: 'Test',
        folderName: 'test',
        avatarDataUrl: null,
        soul: { kind: 'soul', label: 'SOUL.md', relativePath: 'SOUL.md', content: '# Test\n', exists: true, mtimeMs: 3 },
        agentFiles: [{ kind: 'agent', label: 'test.agent.md', relativePath: '.github\\agents\\test.agent.md', content: '# Test agent\n', exists: true, mtimeMs: 2 }],
        needsRestart: true,
      } }),
      pickAvatarImage: vi.fn().mockResolvedValue({ success: false, error: 'not stubbed' }),
      saveAvatar: vi.fn().mockResolvedValue({ success: false, error: 'not stubbed' }),
      removeAvatar: vi.fn().mockResolvedValue({ success: false, error: 'not stubbed' }),
      restart: vi.fn().mockResolvedValue({ mindId: 'test-1234', mindPath: 'C:\\test', identity: { name: 'Test', systemMessage: '' }, status: 'ready' }),
    },
    userProfile: {
      get: vi.fn().mockResolvedValue({
        displayName: '',
        work: '',
        location: '',
        about: '',
        avatarDataUrl: null,
        source: 'local',
        updatedAt: null,
      }),
      save: vi.fn().mockImplementation((request) => Promise.resolve({
        displayName: request.displayName ?? '',
        work: request.work ?? '',
        location: request.location ?? '',
        about: request.about ?? '',
        avatarDataUrl: request.avatarDataUrl ?? null,
        source: 'local',
        updatedAt: new Date().toISOString(),
      })),
      importFromMicrosoft: vi.fn().mockResolvedValue({
        success: false,
        error: 'not stubbed',
      }),
    },
    lens: {
      getViews: vi.fn().mockResolvedValue([]),
      getViewData: vi.fn().mockResolvedValue(null),
      refreshView: vi.fn().mockResolvedValue(null),
      sendAction: vi.fn().mockResolvedValue(null),
      getCanvasUrl: vi.fn().mockResolvedValue(null),
      onViewsChanged: vi.fn().mockReturnValue(vi.fn()),
    },
    auth: {
      getStatus: vi.fn().mockResolvedValue({ authenticated: true }),
      listAccounts: vi.fn().mockResolvedValue([]),
      startLogin: vi.fn().mockResolvedValue({ success: true }),
      cancelLogin: vi.fn().mockResolvedValue(undefined),
      switchAccount: vi.fn().mockResolvedValue(undefined),
      logout: vi.fn().mockResolvedValue(undefined),
      onProgress: vi.fn().mockReturnValue(vi.fn()),
      onAccountSwitchStarted: vi.fn().mockReturnValue(vi.fn()),
      onAccountSwitched: vi.fn().mockReturnValue(vi.fn()),
      onLoggedOut: vi.fn().mockReturnValue(vi.fn()),
    },
    byoLlm: {
      get: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockResolvedValue({ success: true }),
      disable: vi.fn().mockResolvedValue({ success: true }),
      probe: vi.fn().mockResolvedValue({ ok: true, modelCount: 0, models: [] }),
      restartAgents: vi.fn().mockResolvedValue({ success: true, restartedCount: 0 }),
      onChanged: vi.fn().mockReturnValue(vi.fn()),
    },
    genesis: {
      getDefaultPath: vi.fn().mockResolvedValue('C:\\Users\\test\\agents'),
      pickPath: vi.fn().mockResolvedValue(null),
      listTemplates: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ success: true }),
      createFromTemplate: vi.fn().mockResolvedValue({ success: true }),
      onProgress: vi.fn().mockReturnValue(vi.fn()),
    },
    marketplace: {
      listGenesisRegistries: vi.fn().mockResolvedValue([]),
      addGenesisRegistry: vi.fn().mockResolvedValue({ success: true, registry: {
        id: 'github:agency-microsoft/genesis-minds',
        label: 'agency-microsoft/genesis-minds',
        url: 'https://github.com/agency-microsoft/genesis-minds',
        owner: 'agency-microsoft',
        repo: 'genesis-minds',
        ref: 'main',
        plugin: 'genesis-minds',
        enabled: true,
        isDefault: false,
      } }),
      refreshGenesisRegistry: vi.fn().mockResolvedValue({ success: true, registry: {
        id: 'github:ianphil/genesis-minds',
        label: 'Public Genesis Minds',
        url: 'https://github.com/ianphil/genesis-minds',
        owner: 'ianphil',
        repo: 'genesis-minds',
        ref: 'master',
        plugin: 'genesis-minds',
        enabled: true,
        isDefault: true,
      } }),
      setGenesisRegistryEnabled: vi.fn().mockResolvedValue({ success: true, registry: {
        id: 'github:ianphil/genesis-minds',
        label: 'Public Genesis Minds',
        url: 'https://github.com/ianphil/genesis-minds',
        owner: 'ianphil',
        repo: 'genesis-minds',
        ref: 'master',
        plugin: 'genesis-minds',
        enabled: false,
        isDefault: true,
      } }),
      removeGenesisRegistry: vi.fn().mockResolvedValue({ success: true, registry: {
        id: 'github:agency-microsoft/genesis-minds',
        label: 'agency-microsoft/genesis-minds',
        url: 'https://github.com/agency-microsoft/genesis-minds',
        owner: 'agency-microsoft',
        repo: 'genesis-minds',
        ref: 'main',
        plugin: 'genesis-minds',
        enabled: true,
        isDefault: false,
      } }),
    },
    tools: {
      list: vi.fn().mockResolvedValue([]),
      install: vi.fn().mockResolvedValue({ success: false, error: 'not stubbed' }),
      uninstall: vi.fn().mockResolvedValue({ success: true }),
    },
    tasks: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue({ error: 'not stubbed' }),
      cancel: vi.fn().mockResolvedValue({ found: false, cancelled: false, reason: 'not stubbed' }),
      audit: vi.fn().mockResolvedValue({
        counts: { queued: 0, running: 0, succeeded: 0, failed: 0, 'timed-out': 0, cancelled: 0, lost: 0 },
        findings: [],
      }),
    },
    chatroom: {
      send: vi.fn().mockResolvedValue(undefined),
      history: vi.fn().mockResolvedValue([]),
      taskLedger: vi.fn().mockResolvedValue([]),
      clear: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      setOrchestration: vi.fn().mockResolvedValue(undefined),
      getOrchestration: vi.fn().mockResolvedValue({ mode: 'concurrent', config: null }),
      onEvent: vi.fn().mockReturnValue(vi.fn()),
      setMindEnabled: vi.fn().mockResolvedValue(undefined),
      getDisabledMindIds: vi.fn().mockResolvedValue([]),
      onStateChanged: vi.fn().mockReturnValue(vi.fn()),
      listSessions: vi.fn().mockResolvedValue([]),
      createSession: vi.fn().mockResolvedValue({ sessionId: 'cr-1', title: 'New chatroom', createdAt: '', updatedAt: '', active: true, hasMessages: false }),
      resumeSession: vi.fn().mockResolvedValue({
        session: { sessionId: 'cr-1', title: 'New chatroom', createdAt: '', updatedAt: '', active: true, hasMessages: false },
        messages: [],
        taskLedger: [],
      }),
      renameSession: vi.fn().mockResolvedValue([]),
      deleteSession: vi.fn().mockResolvedValue([]),
    },
    updater: {
      getState: vi.fn((): Promise<DesktopUpdateState> => new Promise<DesktopUpdateState>(() => {})),
      check: vi.fn().mockResolvedValue({ success: false }),
      download: vi.fn().mockResolvedValue({ success: false }),
      installAndRestart: vi.fn().mockResolvedValue({ success: false }),
      onStateChanged: vi.fn().mockReturnValue(vi.fn()),
    },
    a2a: {
      onIncoming: vi.fn().mockReturnValue(vi.fn()),
      listAgents: vi.fn().mockResolvedValue([]),
      onTaskStatusUpdate: vi.fn().mockReturnValue(vi.fn()),
      onTaskArtifactUpdate: vi.fn().mockReturnValue(vi.fn()),
      getTask: vi.fn().mockResolvedValue(null),
      listTasks: vi.fn().mockResolvedValue([]),
      cancelTask: vi.fn().mockResolvedValue(undefined),
      relayStatus: vi.fn().mockResolvedValue({
        state: 'disconnected',
        mode: 'local',
        relayBaseUrl: null,
        publishedBaseUrl: null,
        publishedAgentCount: 0,
        relayAgentCount: 0,
        lastError: null,
        connectedAt: null,
      }),
      relayConnect: vi.fn().mockResolvedValue({
        state: 'connected',
        mode: 'relay',
        relayBaseUrl: 'http://127.0.0.1:4317',
        publishedBaseUrl: 'http://127.0.0.1:4488',
        publishedAgentCount: 0,
        relayAgentCount: 0,
        lastError: null,
        connectedAt: 1,
      }),
      relayDisconnect: vi.fn().mockResolvedValue({
        state: 'disconnected',
        mode: 'local',
        relayBaseUrl: null,
        publishedBaseUrl: null,
        publishedAgentCount: 0,
        relayAgentCount: 0,
        lastError: null,
        connectedAt: null,
      }),
      onRelayStateChanged: vi.fn().mockReturnValue(vi.fn()),
    },
    window: {
      minimize: vi.fn(),
      maximize: vi.fn(),
      close: vi.fn(),
    },
    app: {
      getFeatureFlags: vi.fn().mockResolvedValue({ switchboardRelay: false, byoLlm: false, chamberCopilot: false }),
      onStartupProgress: vi.fn().mockReturnValue(vi.fn()),
    },
  };
}

// ---------------------------------------------------------------------------
// Chatroom factories
// ---------------------------------------------------------------------------

export function makeChatroomMessage(
  overrides?: Partial<ChatroomMessage>,
): ChatroomMessage {
  return {
    id: 'cr-msg-1',
    role: 'assistant',
    blocks: [{ type: 'text', content: 'hello from agent' }],
    timestamp: Date.now(),
    sender: { mindId: 'mind-1', name: 'Agent One' },
    roundId: 'round-1',
    ...overrides,
  };
}

export function installElectronAPI(api?: ElectronAPI): ElectronAPI {
  const mock = api ?? mockElectronAPI();
  Object.defineProperty(window, 'electronAPI', { value: mock, writable: true, configurable: true });
  return mock;
}

