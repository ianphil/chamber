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
  ElectronAPI,
  DesktopUpdateState,
} from '../shared/types';
import type {
  ChatroomMessage,
  ChatroomStreamEvent,
  GroupChatConfig,
  HandoffConfig,
  MagenticConfig,
  OrchestrationEvent,
  OrchestrationEventType,
} from '../shared/chatroom-types';

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
      onEvent: vi.fn().mockReturnValue(vi.fn()),
    },
    mind: {
      add: vi.fn().mockResolvedValue({ mindId: 'test-1234', mindPath: 'C:\\test', identity: { name: 'Test', systemMessage: '' }, status: 'ready' }),
      remove: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue([]),
      setActive: vi.fn().mockResolvedValue(undefined),
      selectDirectory: vi.fn().mockResolvedValue(null),
      openWindow: vi.fn().mockResolvedValue(undefined),
      onMindChanged: vi.fn().mockReturnValue(vi.fn()),
    },
    lens: {
      getViews: vi.fn().mockResolvedValue([]),
      getViewData: vi.fn().mockResolvedValue(null),
      refreshView: vi.fn().mockResolvedValue(null),
      sendAction: vi.fn().mockResolvedValue(null),
      onViewsChanged: vi.fn().mockReturnValue(vi.fn()),
    },
    auth: {
      getStatus: vi.fn().mockResolvedValue({ authenticated: true }),
      listAccounts: vi.fn().mockResolvedValue([]),
      startLogin: vi.fn().mockResolvedValue({ success: true }),
      switchAccount: vi.fn().mockResolvedValue(undefined),
      logout: vi.fn().mockResolvedValue(undefined),
      onProgress: vi.fn().mockReturnValue(vi.fn()),
      onAccountSwitchStarted: vi.fn().mockReturnValue(vi.fn()),
      onAccountSwitched: vi.fn().mockReturnValue(vi.fn()),
      onLoggedOut: vi.fn().mockReturnValue(vi.fn()),
    },
    genesis: {
      getDefaultPath: vi.fn().mockResolvedValue('C:\\Users\\test\\agents'),
      pickPath: vi.fn().mockResolvedValue(null),
      listTemplates: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ success: true }),
      createFromTemplate: vi.fn().mockResolvedValue({ success: true }),
      onProgress: vi.fn().mockReturnValue(vi.fn()),
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
    },
    window: {
      minimize: vi.fn(),
      maximize: vi.fn(),
      close: vi.fn(),
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

export function makeChatroomStreamEvent(
  overrides?: Partial<ChatroomStreamEvent>,
): ChatroomStreamEvent {
  return {
    mindId: 'mind-1',
    mindName: 'Agent One',
    messageId: 'cr-msg-1',
    roundId: 'round-1',
    event: { type: 'chunk', content: 'hello' },
    ...overrides,
  };
}

export function installElectronAPI(api?: ElectronAPI): ElectronAPI {
  const mock = api ?? mockElectronAPI();
  Object.defineProperty(window, 'electronAPI', { value: mock, writable: true, configurable: true });
  return mock;
}

// ---------------------------------------------------------------------------
// Orchestration factories
// ---------------------------------------------------------------------------

export function makeOrchestrationEvent(
  type: OrchestrationEventType = 'orchestration:turn-start',
  data: Record<string, unknown> = { speaker: 'Agent One', speakerMindId: 'agent-1' },
): OrchestrationEvent {
  return { type, data } as OrchestrationEvent;
}

export function makeGroupChatConfig(
  overrides?: Partial<GroupChatConfig>,
): GroupChatConfig {
  return {
    moderatorMindId: 'moderator-1',
    maxTurns: 10,
    minRounds: 1,
    maxSpeakerRepeats: 3,
    ...overrides,
  };
}

export function makeHandoffConfig(
  overrides?: Partial<HandoffConfig>,
): HandoffConfig {
  return {
    maxHandoffHops: 5,
    ...overrides,
  };
}

export function makeMagenticConfig(
  overrides?: Partial<MagenticConfig>,
): MagenticConfig {
  return {
    managerMindId: 'manager-1',
    maxSteps: 10,
    ...overrides,
  };
}
