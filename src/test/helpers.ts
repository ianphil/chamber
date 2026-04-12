import { vi } from 'vitest';
import type {
  AgentStatus,
  ChatMessage,
  ChatEvent,
  ContentBlock,
  TextBlock,
  ToolCallBlock,
  ReasoningBlock,
  ModelInfo,
  LensViewManifest,
  ElectronAPI,
} from '../shared/types';

// ---------------------------------------------------------------------------
// AgentStatus factories
// ---------------------------------------------------------------------------

export function defaultAgentStatus(): AgentStatus {
  return {
    connected: false,
    mindPath: null,
    agentName: null,
    sessionActive: false,
    uptime: null,
    error: null,
    extensions: [],
  };
}

export function connectedAgentStatus(overrides?: Partial<AgentStatus>): AgentStatus {
  return {
    connected: true,
    mindPath: 'C:\\test\\mind',
    agentName: 'test-agent',
    sessionActive: true,
    uptime: 100,
    error: null,
    extensions: [],
    ...overrides,
  };
}

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
    done: {},
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
      newConversation: vi.fn().mockResolvedValue(undefined),
      listModels: vi.fn().mockResolvedValue([]),
      onEvent: vi.fn().mockReturnValue(() => {}),
    },
    agent: {
      getStatus: vi.fn().mockResolvedValue(defaultAgentStatus()),
      selectMindDirectory: vi.fn().mockResolvedValue(null),
      setMindPath: vi.fn().mockResolvedValue(undefined),
      onStatusChanged: vi.fn().mockReturnValue(() => {}),
    },
    mind: {
      add: vi.fn().mockResolvedValue({ mindId: 'test-1234', mindPath: 'C:\\test', identity: { name: 'Test', systemMessage: '' }, status: 'ready' }),
      remove: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue([]),
      setActive: vi.fn().mockResolvedValue(undefined),
      selectDirectory: vi.fn().mockResolvedValue(null),
      onMindChanged: vi.fn().mockReturnValue(() => {}),
    },
    lens: {
      getViews: vi.fn().mockResolvedValue([]),
      getViewData: vi.fn().mockResolvedValue(null),
      refreshView: vi.fn().mockResolvedValue(null),
      sendAction: vi.fn().mockResolvedValue(null),
      onViewsChanged: vi.fn().mockReturnValue(() => {}),
    },
    auth: {
      getStatus: vi.fn().mockResolvedValue({ authenticated: true }),
      startLogin: vi.fn().mockResolvedValue({ success: true }),
      onProgress: vi.fn().mockReturnValue(() => {}),
    },
    genesis: {
      getDefaultPath: vi.fn().mockResolvedValue('C:\\Users\\test\\agents'),
      pickPath: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ success: true }),
      onProgress: vi.fn().mockReturnValue(() => {}),
    },
    config: {
      load: vi.fn().mockResolvedValue({ mindPath: null, theme: 'dark' }),
      save: vi.fn().mockResolvedValue(undefined),
    },
    window: {
      minimize: vi.fn(),
      maximize: vi.fn(),
      close: vi.fn(),
    },
  };
}

export function installElectronAPI(api?: ElectronAPI): ElectronAPI {
  const mock = api ?? mockElectronAPI();
  Object.defineProperty(window, 'electronAPI', { value: mock, writable: true, configurable: true });
  return mock;
}
