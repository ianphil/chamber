import type { AppState, AppAction } from '../state';
import { conversationViewFor, mergeConversationSummaries, setConversationView } from './helpers';

type Handler<T extends AppAction['type']> = (
  state: AppState,
  action: Extract<AppAction, { type: T }>,
) => Partial<AppState> | AppState;

function setConversationHistory(
  state: AppState,
  action: Extract<AppAction, { type: 'SET_CONVERSATION_HISTORY' }>,
): Partial<AppState> {
  const conversations = mergeConversationSummaries(
    state.conversationHistoryByMind[action.payload.mindId],
    action.payload.conversations,
  );
  const activeSessionId = conversations.find((conversation) => conversation.active)?.sessionId;
  const currentView = conversationViewFor(state, action.payload.mindId);
  const hasLocalMessages = (state.messagesByMind[action.payload.mindId]?.length ?? 0) > 0;
  const shouldBindLocalReadyView =
    currentView.status === 'ready' && currentView.sessionId === undefined && hasLocalMessages;
  const shouldPreserveView =
    (currentView.status === 'ready' && currentView.sessionId === activeSessionId) ||
    (currentView.status === 'hydrating' && currentView.pendingSessionId === activeSessionId);

  return {
    conversationHistoryByMind: {
      ...state.conversationHistoryByMind,
      [action.payload.mindId]: conversations,
    },
    activeConversationByMind: {
      ...state.activeConversationByMind,
      [action.payload.mindId]: activeSessionId,
    },
    conversationViewByMind: !activeSessionId
      ? setConversationView(state, action.payload.mindId, {
          status: 'idle',
          sessionId: undefined,
          pendingSessionId: undefined,
          error: undefined,
        })
      : shouldBindLocalReadyView
        ? setConversationView(state, action.payload.mindId, {
            status: 'ready',
            sessionId: activeSessionId,
            pendingSessionId: undefined,
            error: undefined,
          })
        : !shouldPreserveView
          ? setConversationView(state, action.payload.mindId, {
              status: 'idle',
              sessionId: activeSessionId,
              pendingSessionId: undefined,
              error: undefined,
            })
          : state.conversationViewByMind,
  };
}

function conversationHydrating(
  state: AppState,
  action: Extract<AppAction, { type: 'CONVERSATION_HYDRATING' }>,
): Partial<AppState> {
  return {
    activeConversationByMind: {
      ...state.activeConversationByMind,
      [action.payload.mindId]: action.payload.sessionId,
    },
    conversationViewByMind: setConversationView(state, action.payload.mindId, {
      status: 'hydrating',
      sessionId: action.payload.sessionId,
      pendingSessionId: action.payload.sessionId,
      error: undefined,
    }),
  };
}

function conversationHydrateFailed(
  state: AppState,
  action: Extract<AppAction, { type: 'CONVERSATION_HYDRATE_FAILED' }>,
): Partial<AppState> | AppState {
  const currentView = conversationViewFor(state, action.payload.mindId);
  if (currentView.pendingSessionId && currentView.pendingSessionId !== action.payload.sessionId) return state;
  return {
    conversationViewByMind: setConversationView(state, action.payload.mindId, {
      status: 'idle',
      sessionId: action.payload.sessionId,
      pendingSessionId: undefined,
      error: action.payload.error,
    }),
  };
}

function resumeConversation(
  state: AppState,
  action: Extract<AppAction, { type: 'RESUME_CONVERSATION' }>,
): Partial<AppState> | AppState {
  const currentView = conversationViewFor(state, action.payload.mindId);
  if (currentView.pendingSessionId && currentView.pendingSessionId !== action.payload.sessionId) return state;
  return {
    messagesByMind: {
      ...state.messagesByMind,
      [action.payload.mindId]: action.payload.messages,
    },
    conversationHistoryByMind: {
      ...state.conversationHistoryByMind,
      [action.payload.mindId]: action.payload.conversations,
    },
    activeConversationByMind: {
      ...state.activeConversationByMind,
      [action.payload.mindId]: action.payload.sessionId,
    },
    streamingByMind: {
      ...state.streamingByMind,
      [action.payload.mindId]: false,
    },
    conversationViewByMind: setConversationView(state, action.payload.mindId, {
      status: 'ready',
      sessionId: action.payload.sessionId,
      pendingSessionId: undefined,
      streaming: false,
      error: undefined,
    }),
    isStreaming: state.activeMindId === action.payload.mindId ? false : state.isStreaming,
  };
}

export const conversationHandlers: {
  SET_CONVERSATION_HISTORY: Handler<'SET_CONVERSATION_HISTORY'>;
  CONVERSATION_HYDRATING: Handler<'CONVERSATION_HYDRATING'>;
  CONVERSATION_HYDRATE_FAILED: Handler<'CONVERSATION_HYDRATE_FAILED'>;
  RESUME_CONVERSATION: Handler<'RESUME_CONVERSATION'>;
} = {
  SET_CONVERSATION_HISTORY: setConversationHistory,
  CONVERSATION_HYDRATING: conversationHydrating,
  CONVERSATION_HYDRATE_FAILED: conversationHydrateFailed,
  RESUME_CONVERSATION: resumeConversation,
};
