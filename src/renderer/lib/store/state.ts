import type { ChatMessage, ChatEvent, AgentStatus, ModelInfo, LensViewManifest, ContentBlock } from '../../../shared/types';

export type LensView = 'chat' | string;

export interface AppState {
  messages: ChatMessage[];
  conversationId: string;
  isStreaming: boolean;
  agentStatus: AgentStatus;
  availableModels: ModelInfo[];
  selectedModel: string | null;
  activeView: LensView;
  discoveredViews: LensViewManifest[];
  showLanding: boolean;
}

export type AppAction =
  | { type: 'ADD_USER_MESSAGE'; payload: { id: string; content: string; timestamp: number } }
  | { type: 'ADD_ASSISTANT_MESSAGE'; payload: { id: string; timestamp: number } }
  | { type: 'CHAT_EVENT'; payload: { messageId: string; event: ChatEvent } }
  | { type: 'SET_AGENT_STATUS'; payload: AgentStatus }
  | { type: 'SET_AVAILABLE_MODELS'; payload: ModelInfo[] }
  | { type: 'SET_SELECTED_MODEL'; payload: string | null }
  | { type: 'SET_ACTIVE_VIEW'; payload: LensView }
  | { type: 'SET_DISCOVERED_VIEWS'; payload: LensViewManifest[] }
  | { type: 'SHOW_LANDING' }
  | { type: 'HIDE_LANDING' }
  | { type: 'CLEAR_MESSAGES' }
  | { type: 'NEW_CONVERSATION' };

export const initialState: AppState = {
  messages: [],
  conversationId: `conv-${Date.now()}`,
  isStreaming: false,
  agentStatus: {
    connected: false,
    mindPath: null,
    agentName: null,
    sessionActive: false,
    uptime: null,
    error: null,
    extensions: [],
  },
  availableModels: [],
  selectedModel: localStorage.getItem('chamber:selectedModel'),
  activeView: 'chat',
  discoveredViews: [],
  showLanding: false,
};
