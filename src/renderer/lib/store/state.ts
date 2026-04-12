import type { ChatMessage, ChatEvent, AgentStatus, ModelInfo, LensViewManifest, MindContext, ContentBlock } from '../../../shared/types';

export type LensView = 'chat' | string;

export interface AppState {
  minds: MindContext[];
  activeMindId: string | null;
  messagesByMind: Record<string, ChatMessage[]>;
  isStreaming: boolean;
  /** @deprecated Use minds array instead */
  agentStatus: AgentStatus;
  availableModels: ModelInfo[];
  selectedModel: string | null;
  activeView: LensView;
  discoveredViews: LensViewManifest[];
  showLanding: boolean;
  mindsChecked: boolean;
}

export type AppAction =
  | { type: 'ADD_USER_MESSAGE'; payload: { id: string; content: string; timestamp: number } }
  | { type: 'ADD_ASSISTANT_MESSAGE'; payload: { id: string; timestamp: number } }
  | { type: 'CHAT_EVENT'; payload: { mindId: string; messageId: string; event: ChatEvent } }
  | { type: 'SET_MINDS'; payload: MindContext[] }
  | { type: 'SET_ACTIVE_MIND'; payload: string | null }
  | { type: 'ADD_MIND'; payload: MindContext }
  | { type: 'REMOVE_MIND'; payload: string }
  | { type: 'SET_AGENT_STATUS'; payload: AgentStatus }
  | { type: 'SET_AVAILABLE_MODELS'; payload: ModelInfo[] }
  | { type: 'SET_SELECTED_MODEL'; payload: string | null }
  | { type: 'SET_ACTIVE_VIEW'; payload: LensView }
  | { type: 'SET_DISCOVERED_VIEWS'; payload: LensViewManifest[] }
  | { type: 'SHOW_LANDING' }
  | { type: 'HIDE_LANDING' }
  | { type: 'MINDS_CHECKED' }
  | { type: 'CLEAR_MESSAGES' }
  | { type: 'NEW_CONVERSATION' };

export const initialState: AppState = {
  minds: [],
  activeMindId: null,
  messagesByMind: {},
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
  mindsChecked: false,
};
