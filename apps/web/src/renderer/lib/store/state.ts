import type { ChatMessage, ChatEvent, ConversationSummary, ModelInfo, LensViewManifest, MindContext, ImageBlock } from '@chamber/shared/types';
import type { Message, Task, TaskStatusUpdateEvent, TaskArtifactUpdateEvent } from '@chamber/shared/a2a-types';
import type { ChatroomMessage, ChatroomStreamEvent, OrchestrationMode, GroupChatConfig, HandoffConfig, MagenticConfig, TaskLedgerItem } from '@chamber/shared/chatroom-types';
import { DEFAULT_APP_FEATURE_FLAGS, type AppFeatureFlags } from '@chamber/shared/feature-flags';

export type LensView = 'chat' | string;

export interface AgentProfileSummary {
  mindId: string;
  displayName: string;
  avatarDataUrl: string | null;
}

// Per-mind conversation view state machine:
// idle -> hydrating -> ready. Streaming and model switching are orthogonal
// flags scoped to the same mind/session so history selection and chat content
// cannot drift apart.
export interface ConversationViewState {
  status: 'idle' | 'hydrating' | 'ready';
  sessionId?: string;
  pendingSessionId?: string;
  streaming: boolean;
  modelSwitching: boolean;
  error?: string;
}

export interface AppState {
  minds: MindContext[];
  agentProfileByMindId: Record<string, AgentProfileSummary>;
  activeMindId: string | null;
  runtimePhase: 'ready' | 'switching-account';
  switchingAccountLogin: string | null;
  messagesByMind: Record<string, ChatMessage[]>;
  conversationHistoryByMind: Record<string, ConversationSummary[]>;
  activeConversationByMind: Record<string, string | undefined>;
  conversationViewByMind: Record<string, ConversationViewState>;
  isStreaming: boolean;
  streamingByMind: Record<string, boolean>;
  a2aStreamingByMind: Record<string, boolean>;
  /**
   * Per-mind unsent compose draft text. Switching agents preserves and
   * restores each mind's in-progress message so users can stage thoughts
   * across agents without sending or losing them (#221). Cleared for the
   * active mind when ADD_USER_MESSAGE fires.
   */
  composeDraftByMind: Record<string, string>;
  availableModels: ModelInfo[];
  selectedModel: string | null;
  activeView: LensView;
  /**
   * The view the user was on before navigating into a lens. Lets the
   * lens header render a back button instead of forcing a trip through
   * the activity bar to return. Null when the user is on a built-in.
   */
  previousView: LensView | null;
  featureFlags: AppFeatureFlags;
  discoveredViews: LensViewManifest[];
  showLanding: boolean;
  mindsChecked: boolean;
  tasksByMind: Record<string, Task[]>;
  chatroomMessages: ChatroomMessage[];
  chatroomStreamingByMind: Record<string, boolean>;
  chatroomOrchestration: OrchestrationMode;
  chatroomGroupChatConfig: GroupChatConfig | null;
  chatroomHandoffConfig: HandoffConfig | null;
  chatroomMagenticConfig: MagenticConfig | null;
  /** Who is currently speaking / being selected — shown as typing indicator */
  chatroomActiveSpeaker: { mindId: string; mindName: string; phase: 'speaking' | 'moderating' | 'synthesizing' } | null;
  /** Live task ledger from Magentic orchestration */
  chatroomTaskLedger: TaskLedgerItem[];
  /** Orchestration completion metrics */
  chatroomMetrics: { elapsedMs: number; totalTasks: number; completedTasks: number; failedTasks: number; agentsUsed: number; orchestrationMode: string } | null;
  /** Mind IDs the user has disabled in the chatroom; excluded from broadcasts. */
  chatroomDisabledMindIds: string[];
}

export type AppAction =
  | { type: 'ADD_USER_MESSAGE'; payload: { id: string; content: string; timestamp: number; images?: ImageBlock[] } }
  | { type: 'ADD_ASSISTANT_MESSAGE'; payload: { id: string; timestamp: number } }
  | { type: 'CHAT_EVENT'; payload: { mindId: string; messageId: string; event: ChatEvent } }
  | { type: 'HYDRATE_CHAT_STATE'; payload: { messagesByMind: Record<string, ChatMessage[]>; streamingByMind: Record<string, boolean>; conversationViewByMind?: Record<string, ConversationViewState> } }
  | { type: 'SET_CONVERSATION_HISTORY'; payload: { mindId: string; conversations: ConversationSummary[] } }
  | { type: 'CONVERSATION_HYDRATING'; payload: { mindId: string; sessionId: string } }
  | { type: 'CONVERSATION_HYDRATE_FAILED'; payload: { mindId: string; sessionId: string; error: string } }
  | { type: 'RESUME_CONVERSATION'; payload: { mindId: string; sessionId: string; messages: ChatMessage[]; conversations: ConversationSummary[] } }
  | { type: 'SET_MODEL_SWITCHING'; payload: { mindId: string; switching: boolean } }
  | { type: 'SET_MINDS'; payload: MindContext[] }
  | { type: 'SET_AGENT_PROFILE_SUMMARY'; payload: AgentProfileSummary }
  | { type: 'SET_ACTIVE_MIND'; payload: string | null }
  | { type: 'ADD_MIND'; payload: MindContext }
  | { type: 'REMOVE_MIND'; payload: string }
  | { type: 'SET_AVAILABLE_MODELS'; payload: ModelInfo[] }
  | { type: 'SET_SELECTED_MODEL'; payload: string | null }
  | { type: 'SET_ACTIVE_VIEW'; payload: LensView }
  | { type: 'SET_FEATURE_FLAGS'; payload: AppFeatureFlags }
  | { type: 'SET_DISCOVERED_VIEWS'; payload: LensViewManifest[] }
  | { type: 'SHOW_LANDING' }
  | { type: 'HIDE_LANDING' }
  | { type: 'ACCOUNT_SWITCH_STARTED'; payload: { login: string } }
  | { type: 'ACCOUNT_SWITCH_COMPLETED' }
  | { type: 'LOGGED_OUT' }
  | { type: 'MINDS_CHECKED' }
  | { type: 'CLEAR_MESSAGES' }
  | { type: 'NEW_CONVERSATION'; payload?: { mindId: string } }
  | { type: 'SET_COMPOSE_DRAFT'; payload: { mindId: string; draft: string } }
  | { type: 'A2A_INCOMING'; payload: { targetMindId: string; message: Message; replyMessageId: string } }
  | { type: 'TASK_STATUS_UPDATE'; payload: TaskStatusUpdateEvent & { targetMindId: string } }
  | { type: 'TASK_ARTIFACT_UPDATE'; payload: TaskArtifactUpdateEvent & { targetMindId: string } }
  | { type: 'SET_CHATROOM_HISTORY'; payload: ChatroomMessage[] }
  | { type: 'CHATROOM_USER_MESSAGE'; payload: ChatroomMessage }
  | { type: 'CHATROOM_AGENT_MESSAGE'; payload: { messageId: string; mindId: string; mindName: string; roundId: string; timestamp: number } }
  | { type: 'CHATROOM_EVENT'; payload: ChatroomStreamEvent }
  | { type: 'CHATROOM_CLEAR' }
  | { type: 'SET_CHATROOM_TASK_LEDGER'; payload: TaskLedgerItem[] }
  | { type: 'SET_ORCHESTRATION'; payload: OrchestrationMode }
  | { type: 'SET_GROUP_CHAT_CONFIG'; payload: GroupChatConfig | null }
  | { type: 'SET_HANDOFF_CONFIG'; payload: HandoffConfig | null }
  | { type: 'SET_MAGENTIC_CONFIG'; payload: MagenticConfig | null }
  | { type: 'CHATROOM_ACTIVE_SPEAKER'; payload: { mindId: string; mindName: string; phase: 'speaking' | 'moderating' | 'synthesizing' } | null }
  | { type: 'SET_CHATROOM_DISABLED_MIND_IDS'; payload: string[] };

export const initialState: AppState = {
  minds: [],
  agentProfileByMindId: {},
  activeMindId: null,
  runtimePhase: 'ready',
  switchingAccountLogin: null,
  messagesByMind: {},
  conversationHistoryByMind: {},
  activeConversationByMind: {},
  conversationViewByMind: {},
  isStreaming: false,
  streamingByMind: {},
  a2aStreamingByMind: {},
  composeDraftByMind: {},
  availableModels: [],
  selectedModel: null,
  activeView: 'chat',
  previousView: null,
  featureFlags: DEFAULT_APP_FEATURE_FLAGS,
  discoveredViews: [],
  showLanding: false,
  mindsChecked: false,
  tasksByMind: {},
  chatroomMessages: [],
  chatroomStreamingByMind: {},
  chatroomOrchestration: 'concurrent',
  chatroomGroupChatConfig: null,
  chatroomHandoffConfig: null,
  chatroomMagenticConfig: null,
  chatroomActiveSpeaker: null,
  chatroomTaskLedger: [],
  chatroomMetrics: null,
  chatroomDisabledMindIds: [],
};
