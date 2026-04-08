import React, { createContext, useContext, useReducer, type Dispatch } from 'react';
import type { ChatMessage, AgentStatus } from '../../shared/types';

interface AppState {
  messages: ChatMessage[];
  conversationId: string;
  isStreaming: boolean;
  agentStatus: AgentStatus;
}

type AppAction =
  | { type: 'ADD_USER_MESSAGE'; payload: ChatMessage }
  | { type: 'ADD_ASSISTANT_MESSAGE'; payload: ChatMessage }
  | { type: 'APPEND_CHUNK'; payload: { messageId: string; content: string } }
  | { type: 'FINISH_STREAMING'; payload: { messageId: string } }
  | { type: 'SET_ERROR'; payload: { messageId: string; error: string } }
  | { type: 'SET_STREAMING'; payload: boolean }
  | { type: 'SET_AGENT_STATUS'; payload: AgentStatus }
  | { type: 'CLEAR_MESSAGES' }
  | { type: 'NEW_CONVERSATION' };

const initialState: AppState = {
  messages: [],
  conversationId: `conv-${Date.now()}`,
  isStreaming: false,
  agentStatus: {
    connected: false,
    mindPath: null,
    sessionActive: false,
    uptime: null,
    error: null,
  },
};

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'ADD_USER_MESSAGE':
      return { ...state, messages: [...state.messages, action.payload] };

    case 'ADD_ASSISTANT_MESSAGE':
      return {
        ...state,
        messages: [...state.messages, action.payload],
        isStreaming: true,
      };

    case 'APPEND_CHUNK': {
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === action.payload.messageId
            ? { ...m, content: m.content + action.payload.content }
            : m
        ),
      };
    }

    case 'FINISH_STREAMING':
      return {
        ...state,
        isStreaming: false,
        messages: state.messages.map((m) =>
          m.id === action.payload.messageId
            ? { ...m, isStreaming: false }
            : m
        ),
      };

    case 'SET_ERROR':
      return {
        ...state,
        isStreaming: false,
        messages: state.messages.map((m) =>
          m.id === action.payload.messageId
            ? { ...m, content: `Error: ${action.payload.error}`, isStreaming: false }
            : m
        ),
      };

    case 'SET_STREAMING':
      return { ...state, isStreaming: action.payload };

    case 'SET_AGENT_STATUS':
      return { ...state, agentStatus: action.payload };

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
