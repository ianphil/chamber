import type { ChatMessage, ContentBlock } from '@chamber/shared/types';
import type { AppState, AppAction } from '../state';
import { conversationViewFor, handleChatEvent, setConversationView } from './helpers';

type Handler<T extends AppAction['type']> = (
  state: AppState,
  action: Extract<AppAction, { type: T }>,
) => Partial<AppState> | AppState;

function addUserMessage(state: AppState, action: Extract<AppAction, { type: 'ADD_USER_MESSAGE' }>): Partial<AppState> {
  const activeMindId = state.activeMindId;
  if (!activeMindId) return state;

  const textBlock: ContentBlock = { type: 'text', content: action.payload.content };
  const blocks: ContentBlock[] = action.payload.images && action.payload.images.length > 0
    ? [...action.payload.images, textBlock]
    : [textBlock];

  const composeDraftByMind = state.composeDraftByMind[activeMindId]
    ? (() => {
        const next = { ...state.composeDraftByMind };
        delete next[activeMindId];
        return next;
      })()
    : state.composeDraftByMind;

  const activeMsgs = state.messagesByMind[activeMindId] ?? [];
  return {
    messagesByMind: {
      ...state.messagesByMind,
      [activeMindId]: [
        ...activeMsgs,
        {
          id: action.payload.id,
          role: 'user',
          blocks,
          timestamp: action.payload.timestamp,
        },
      ],
    },
    composeDraftByMind,
  };
}

function addAssistantMessage(state: AppState, action: Extract<AppAction, { type: 'ADD_ASSISTANT_MESSAGE' }>): Partial<AppState> {
  const activeMindId = state.activeMindId;
  const placeholder: ChatMessage = {
    id: action.payload.id,
    role: 'assistant',
    blocks: [],
    timestamp: action.payload.timestamp,
    isStreaming: true,
  };

  if (!activeMindId) {
    return { isStreaming: true };
  }

  const activeMsgs = state.messagesByMind[activeMindId] ?? [];
  return {
    isStreaming: true,
    streamingByMind: { ...state.streamingByMind, [activeMindId]: true },
    conversationViewByMind: setConversationView(state, activeMindId, {
      status: 'ready',
      sessionId: state.activeConversationByMind[activeMindId] ?? conversationViewFor(state, activeMindId).sessionId,
      pendingSessionId: undefined,
      streaming: true,
      error: undefined,
    }),
    messagesByMind: {
      ...state.messagesByMind,
      [activeMindId]: [...activeMsgs, placeholder],
    },
  };
}

function chatEvent(state: AppState, action: Extract<AppAction, { type: 'CHAT_EVENT' }>): Partial<AppState> {
  const { mindId, messageId, event } = action.payload;
  const mindMsgs = state.messagesByMind[mindId] ?? [];
  const newMessages = handleChatEvent(mindMsgs, messageId, event);
  const isDone = event.type === 'done' || event.type === 'error' || event.type === 'timeout';
  const newStreamingByMind = isDone
    ? { ...state.streamingByMind, [mindId]: false }
    : state.streamingByMind;
  return {
    messagesByMind: { ...state.messagesByMind, [mindId]: newMessages },
    isStreaming: isDone ? false : state.isStreaming,
    streamingByMind: newStreamingByMind,
    conversationViewByMind: isDone
      ? setConversationView(state, mindId, {
        status: 'ready',
        sessionId: state.activeConversationByMind[mindId] ?? conversationViewFor(state, mindId).sessionId,
        pendingSessionId: undefined,
        streaming: false,
      })
      : state.conversationViewByMind,
  };
}

function hydrateChatState(state: AppState, action: Extract<AppAction, { type: 'HYDRATE_CHAT_STATE' }>): Partial<AppState> {
  const nextConversationViewByMind = action.payload.conversationViewByMind ?? state.conversationViewByMind;
  const isActiveMindStreaming = state.activeMindId
    ? Boolean(action.payload.streamingByMind[state.activeMindId] || nextConversationViewByMind[state.activeMindId]?.streaming)
    : Object.values(action.payload.streamingByMind).some(Boolean);
  return {
    messagesByMind: action.payload.messagesByMind,
    streamingByMind: action.payload.streamingByMind,
    conversationViewByMind: nextConversationViewByMind,
    isStreaming: isActiveMindStreaming,
  };
}

function clearMessages(state: AppState): Partial<AppState> {
  if (!state.activeMindId) return state;
  return {
    messagesByMind: { ...state.messagesByMind, [state.activeMindId]: [] },
  };
}

function newConversation(state: AppState, action: Extract<AppAction, { type: 'NEW_CONVERSATION' }>): Partial<AppState> {
  const conversationMindId = action.payload?.mindId ?? state.activeMindId;

  const composeDraftByMind = conversationMindId && state.composeDraftByMind[conversationMindId]
    ? (() => {
        const next = { ...state.composeDraftByMind };
        delete next[conversationMindId];
        return next;
      })()
    : state.composeDraftByMind;

  return {
    messagesByMind: conversationMindId
      ? { ...state.messagesByMind, [conversationMindId]: [] }
      : state.messagesByMind,
    composeDraftByMind,
    isStreaming: conversationMindId === state.activeMindId ? false : state.isStreaming,
    streamingByMind: conversationMindId
      ? { ...state.streamingByMind, [conversationMindId]: false }
      : state.streamingByMind,
    conversationViewByMind: conversationMindId
      ? setConversationView(state, conversationMindId, {
        status: 'idle',
        sessionId: undefined,
        pendingSessionId: undefined,
        streaming: false,
      })
      : state.conversationViewByMind,
    chatroomMessages: [],
    chatroomStreamingByMind: {},
    chatroomActiveSpeaker: null,
    chatroomTaskLedger: [],
    chatroomMetrics: null,
  };
}

function setComposeDraft(state: AppState, action: Extract<AppAction, { type: 'SET_COMPOSE_DRAFT' }>): Partial<AppState> {
  const { mindId, draft } = action.payload;
  const previous = state.composeDraftByMind[mindId] ?? '';
  if (draft === previous) return state;

  if (draft === '') {
    if (!(mindId in state.composeDraftByMind)) return state;
    const next = { ...state.composeDraftByMind };
    delete next[mindId];
    return { composeDraftByMind: next };
  }
  return {
    composeDraftByMind: { ...state.composeDraftByMind, [mindId]: draft },
  };
}

function setModelSwitching(state: AppState, action: Extract<AppAction, { type: 'SET_MODEL_SWITCHING' }>): Partial<AppState> {
  return {
    conversationViewByMind: setConversationView(state, action.payload.mindId, {
      modelSwitching: action.payload.switching,
    }),
  };
}

export const messagesHandlers: {
  ADD_USER_MESSAGE: Handler<'ADD_USER_MESSAGE'>;
  ADD_ASSISTANT_MESSAGE: Handler<'ADD_ASSISTANT_MESSAGE'>;
  CHAT_EVENT: Handler<'CHAT_EVENT'>;
  HYDRATE_CHAT_STATE: Handler<'HYDRATE_CHAT_STATE'>;
  CLEAR_MESSAGES: Handler<'CLEAR_MESSAGES'>;
  NEW_CONVERSATION: Handler<'NEW_CONVERSATION'>;
  SET_COMPOSE_DRAFT: Handler<'SET_COMPOSE_DRAFT'>;
  SET_MODEL_SWITCHING: Handler<'SET_MODEL_SWITCHING'>;
} = {
  ADD_USER_MESSAGE: addUserMessage,
  ADD_ASSISTANT_MESSAGE: addAssistantMessage,
  CHAT_EVENT: chatEvent,
  HYDRATE_CHAT_STATE: hydrateChatState,
  CLEAR_MESSAGES: clearMessages,
  NEW_CONVERSATION: newConversation,
  SET_COMPOSE_DRAFT: setComposeDraft,
  SET_MODEL_SWITCHING: setModelSwitching,
};
