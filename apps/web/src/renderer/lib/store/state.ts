import type { ChatMessage, ChatEvent, ModelInfo, LensViewManifest, MindContext, ImageBlock } from '@chamber/shared/types';
import type { Message, Task, TaskStatusUpdateEvent, TaskArtifactUpdateEvent } from '@chamber/shared/a2a-types';
import type { ChatroomMessage, ChatroomStreamEvent, OrchestrationMode, GroupChatConfig, HandoffConfig, MagenticConfig, TaskLedgerItem } from '@chamber/shared/chatroom-types';

export type LensView = 'chat' | string;

export interface AppState {
  minds: MindContext[];
  activeMindId: string | null;
  runtimePhase: 'ready' | 'switching-account';
  switchingAccountLogin: string | null;
  messagesByMind: Record<string, ChatMessage[]>;
  isStreaming: boolean;
  streamingByMind: Record<string, boolean>;
  availableModels: ModelInfo[];
  selectedModel: string | null;
  activeView: LensView;
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
}

export type AppAction =
  | { type: 'ADD_USER_MESSAGE'; payload: { id: string; content: string; timestamp: number; images?: ImageBlock[] } }
  | { type: 'ADD_ASSISTANT_MESSAGE'; payload: { id: string; timestamp: number } }
  | { type: 'CHAT_EVENT'; payload: { mindId: string; messageId: string; event: ChatEvent } }
  | { type: 'SET_MINDS'; payload: MindContext[] }
  | { type: 'SET_ACTIVE_MIND'; payload: string | null }
  | { type: 'ADD_MIND'; payload: MindContext }
  | { type: 'REMOVE_MIND'; payload: string }
  | { type: 'SET_AVAILABLE_MODELS'; payload: ModelInfo[] }
  | { type: 'SET_SELECTED_MODEL'; payload: string | null }
  | { type: 'SET_ACTIVE_VIEW'; payload: LensView }
  | { type: 'SET_DISCOVERED_VIEWS'; payload: LensViewManifest[] }
  | { type: 'SHOW_LANDING' }
  | { type: 'HIDE_LANDING' }
  | { type: 'ACCOUNT_SWITCH_STARTED'; payload: { login: string } }
  | { type: 'ACCOUNT_SWITCH_COMPLETED' }
  | { type: 'LOGGED_OUT' }
  | { type: 'MINDS_CHECKED' }
  | { type: 'CLEAR_MESSAGES' }
  | { type: 'NEW_CONVERSATION' }
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
  | { type: 'CHATROOM_ACTIVE_SPEAKER'; payload: { mindId: string; mindName: string; phase: 'speaking' | 'moderating' | 'synthesizing' } | null };

export const initialState: AppState = {
  minds: [],
  activeMindId: null,
  runtimePhase: 'ready',
  switchingAccountLogin: null,
  messagesByMind: {},
  isStreaming: false,
  streamingByMind: {},
  availableModels: [],
  selectedModel: localStorage.getItem('chamber:selectedModel'),
  activeView: 'chat',
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
};
