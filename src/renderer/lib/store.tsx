import React, { createContext, useContext, useReducer, type Dispatch } from 'react';
import type { ChatMessage, ChatEvent, AgentStatus, ModelInfo, LensViewManifest, ContentBlock } from '../../shared/types';

export type LensView = 'chat' | string;

interface AppState {
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

type AppAction =
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

const initialState: AppState = {
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

/** Extract plain text from content blocks (for search, accessibility, etc.) */
export function getPlainContent(message: ChatMessage): string {
  return message.blocks
    .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
    .map(b => b.content)
    .join('');
}

function handleChatEvent(messages: ChatMessage[], messageId: string, event: ChatEvent): ChatMessage[] {
  return messages.map((m) => {
    if (m.id !== messageId) return m;

    const blocks = [...m.blocks];

    switch (event.type) {
      case 'chunk': {
        // Append to last text block, or create one
        const last = blocks[blocks.length - 1];
        if (last && last.type === 'text') {
          blocks[blocks.length - 1] = { ...last, content: last.content + event.content, sdkMessageId: event.sdkMessageId };
        } else {
          blocks.push({ type: 'text', sdkMessageId: event.sdkMessageId, content: event.content });
        }
        return { ...m, blocks };
      }

      case 'tool_start': {
        blocks.push({
          type: 'tool_call',
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          status: 'running',
          arguments: event.args,
          parentToolCallId: event.parentToolCallId,
        });
        return { ...m, blocks };
      }

      case 'tool_progress': {
        const idx = blocks.findIndex(b => b.type === 'tool_call' && b.toolCallId === event.toolCallId);
        if (idx >= 0) {
          const block = blocks[idx] as Extract<ContentBlock, { type: 'tool_call' }>;
          blocks[idx] = { ...block, output: (block.output || '') + event.message + '\n' };
        }
        return { ...m, blocks };
      }

      case 'tool_output': {
        const idx = blocks.findIndex(b => b.type === 'tool_call' && b.toolCallId === event.toolCallId);
        if (idx >= 0) {
          const block = blocks[idx] as Extract<ContentBlock, { type: 'tool_call' }>;
          blocks[idx] = { ...block, output: (block.output || '') + event.output };
        }
        return { ...m, blocks };
      }

      case 'tool_done': {
        const idx = blocks.findIndex(b => b.type === 'tool_call' && b.toolCallId === event.toolCallId);
        if (idx >= 0) {
          const block = blocks[idx] as Extract<ContentBlock, { type: 'tool_call' }>;
          blocks[idx] = {
            ...block,
            status: event.success ? 'done' : 'error',
            ...(event.result && { output: (block.output || '') + event.result }),
            ...(event.error && { error: event.error }),
          };
        }
        return { ...m, blocks };
      }

      case 'reasoning': {
        const last = blocks[blocks.length - 1];
        if (last && last.type === 'reasoning' && last.reasoningId === event.reasoningId) {
          blocks[blocks.length - 1] = { ...last, content: last.content + event.content };
        } else {
          blocks.push({ type: 'reasoning', reasoningId: event.reasoningId, content: event.content });
        }
        return { ...m, blocks };
      }

      case 'message_final': {
        // Reconciliation: if no text blocks exist yet, create one
        const hasText = blocks.some(b => b.type === 'text');
        if (!hasText && event.content) {
          blocks.push({ type: 'text', sdkMessageId: event.sdkMessageId, content: event.content });
          return { ...m, blocks };
        }
        return m;
      }

      case 'done':
        return { ...m, isStreaming: false };

      case 'error':
        return {
          ...m,
          isStreaming: false,
          blocks: [...blocks, { type: 'text' as const, content: `Error: ${event.message}` }],
        };

      default:
        return m;
    }
  });
}

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'ADD_USER_MESSAGE':
      return {
        ...state,
        messages: [...state.messages, {
          id: action.payload.id,
          role: 'user',
          blocks: [{ type: 'text', content: action.payload.content }],
          timestamp: action.payload.timestamp,
        }],
      };

    case 'ADD_ASSISTANT_MESSAGE':
      return {
        ...state,
        isStreaming: true,
        messages: [...state.messages, {
          id: action.payload.id,
          role: 'assistant',
          blocks: [],
          timestamp: action.payload.timestamp,
          isStreaming: true,
        }],
      };

    case 'CHAT_EVENT': {
      const { messageId, event } = action.payload;
      const newMessages = handleChatEvent(state.messages, messageId, event);
      const isDone = event.type === 'done' || event.type === 'error';
      return {
        ...state,
        messages: newMessages,
        isStreaming: isDone ? false : state.isStreaming,
      };
    }

    case 'SET_AGENT_STATUS':
      return { ...state, agentStatus: action.payload };

    case 'SET_AVAILABLE_MODELS':
      return { ...state, availableModels: action.payload };

    case 'SET_SELECTED_MODEL':
      if (action.payload) {
        localStorage.setItem('chamber:selectedModel', action.payload);
      } else {
        localStorage.removeItem('chamber:selectedModel');
      }
      return { ...state, selectedModel: action.payload };

    case 'SET_ACTIVE_VIEW':
      return { ...state, activeView: action.payload };

    case 'SET_DISCOVERED_VIEWS':
      return { ...state, discoveredViews: action.payload };

    case 'SHOW_LANDING':
      return { ...state, showLanding: true };

    case 'HIDE_LANDING':
      return { ...state, showLanding: false };

    case 'CLEAR_MESSAGES':
      return { ...state, messages: [] };

    case 'NEW_CONVERSATION':
      return {
        ...state,
        messages: [],
        conversationId: `conv-${Date.now()}`,
        isStreaming: false,
      };

    default:
      return state;
  }
}

const AppStateContext = createContext<AppState>(initialState);
const AppDispatchContext = createContext<Dispatch<AppAction>>(() => {});

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);

  return (
    <AppStateContext.Provider value={state}>
      <AppDispatchContext.Provider value={dispatch}>
        {children}
      </AppDispatchContext.Provider>
    </AppStateContext.Provider>
  );
}

export function useAppState() {
  return useContext(AppStateContext);
}

export function useAppDispatch() {
  return useContext(AppDispatchContext);
}
