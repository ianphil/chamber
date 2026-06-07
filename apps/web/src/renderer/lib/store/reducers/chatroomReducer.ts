import type { ChatroomMessage, TaskLedgerItem } from '@chamber/shared/chatroom-types';
import { isOrchestrationEvent } from '@chamber/shared/chatroom-types';
import type { ChatEvent } from '@chamber/shared/types';
import type { AppState, AppAction } from '../state';
import { handleChatEvent } from './helpers';

type Handler<T extends AppAction['type']> = (
  state: AppState,
  action: Extract<AppAction, { type: T }>,
) => Partial<AppState> | AppState;

function setChatroomHistory(
  _state: AppState,
  action: Extract<AppAction, { type: 'SET_CHATROOM_HISTORY' }>,
): Partial<AppState> {
  return { chatroomMessages: action.payload };
}

function chatroomUserMessage(
  state: AppState,
  action: Extract<AppAction, { type: 'CHATROOM_USER_MESSAGE' }>,
): Partial<AppState> {
  return {
    chatroomMessages: [...state.chatroomMessages, action.payload],
    chatroomActiveSpeaker: null,
    chatroomMetrics: null,
    chatroomTaskLedger: [],
  };
}

function chatroomAgentMessage(
  state: AppState,
  action: Extract<AppAction, { type: 'CHATROOM_AGENT_MESSAGE' }>,
): Partial<AppState> {
  const { messageId, mindId, mindName, roundId, timestamp } = action.payload;
  const agentMsg: ChatroomMessage = {
    id: messageId,
    role: 'assistant',
    blocks: [],
    timestamp,
    isStreaming: true,
    sender: { mindId, name: mindName },
    roundId,
  };
  return {
    chatroomMessages: [...state.chatroomMessages, agentMsg],
    chatroomStreamingByMind: { ...state.chatroomStreamingByMind, [mindId]: true },
  };
}

function chatroomEvent(
  state: AppState,
  action: Extract<AppAction, { type: 'CHATROOM_EVENT' }>,
): Partial<AppState> | AppState {
  const { mindId, mindName, messageId, roundId, event } = action.payload;

  if (isOrchestrationEvent(event)) {
    switch (event.type) {
      case 'orchestration:turn-start':
        return {
          chatroomActiveSpeaker: {
            mindId: event.data.speakerMindId ?? mindId,
            mindName: event.data.speaker ?? mindName,
            phase: 'speaking',
          },
        };

      case 'orchestration:moderator-decision':
        return {
          chatroomActiveSpeaker: { mindId, mindName, phase: 'moderating' },
        };

      case 'orchestration:synthesis':
        return {
          chatroomActiveSpeaker: { mindId, mindName, phase: 'synthesizing' },
        };

      case 'orchestration:convergence':
      case 'orchestration:handoff-terminated':
      case 'orchestration:magentic-terminated':
        return { chatroomActiveSpeaker: null };

      case 'orchestration:handoff':
        return {
          chatroomActiveSpeaker: {
            mindId: event.data.toMindId ?? mindId,
            mindName: event.data.to ?? mindName,
            phase: 'speaking',
          },
        };

      case 'orchestration:manager-plan':
      case 'orchestration:task-ledger-update':
        return {
          chatroomActiveSpeaker: { mindId, mindName, phase: 'moderating' },
          ...(event.type === 'orchestration:task-ledger-update' && event.data.ledger
            ? { chatroomTaskLedger: event.data.ledger as TaskLedgerItem[] }
            : {}),
        };

      case 'orchestration:metrics':
        return {
          chatroomMetrics: event.data as AppState['chatroomMetrics'],
        };

      case 'orchestration:approval-requested':
      case 'orchestration:approval-decided':
      default:
        return state;
    }
  }

  // ChatEvent path (non-orchestration)
  const chatEvent = event as ChatEvent;
  let messages = state.chatroomMessages;

  const exists = messages.some((m) => m.id === messageId);
  if (!exists) {
    const placeholder: ChatroomMessage = {
      id: messageId,
      role: 'assistant',
      blocks: [],
      timestamp: Date.now(),
      isStreaming: true,
      sender: { mindId, name: mindName },
      roundId,
    };
    messages = [...messages, placeholder];
  }

  const newMessages = handleChatEvent(messages, messageId, chatEvent);
  const isDone = chatEvent.type === 'done' || chatEvent.type === 'error' || chatEvent.type === 'timeout';
  return {
    chatroomMessages: newMessages,
    chatroomStreamingByMind: isDone
      ? { ...state.chatroomStreamingByMind, [mindId]: false }
      : { ...state.chatroomStreamingByMind, [mindId]: true },
    ...(isDone && state.chatroomActiveSpeaker?.mindId === mindId
      ? { chatroomActiveSpeaker: null }
      : {}),
  };
}

function chatroomClear(): Partial<AppState> {
  return {
    chatroomMessages: [],
    chatroomStreamingByMind: {},
    chatroomActiveSpeaker: null,
    chatroomTaskLedger: [],
    chatroomMetrics: null,
  };
}

function setChatroomTaskLedger(
  _state: AppState,
  action: Extract<AppAction, { type: 'SET_CHATROOM_TASK_LEDGER' }>,
): Partial<AppState> {
  return { chatroomTaskLedger: action.payload };
}

function setOrchestration(
  _state: AppState,
  action: Extract<AppAction, { type: 'SET_ORCHESTRATION' }>,
): Partial<AppState> {
  return { chatroomOrchestration: action.payload };
}

function setGroupChatConfig(
  _state: AppState,
  action: Extract<AppAction, { type: 'SET_GROUP_CHAT_CONFIG' }>,
): Partial<AppState> {
  return { chatroomGroupChatConfig: action.payload };
}

function setHandoffConfig(
  _state: AppState,
  action: Extract<AppAction, { type: 'SET_HANDOFF_CONFIG' }>,
): Partial<AppState> {
  return { chatroomHandoffConfig: action.payload };
}

function setMagenticConfig(
  _state: AppState,
  action: Extract<AppAction, { type: 'SET_MAGENTIC_CONFIG' }>,
): Partial<AppState> {
  return { chatroomMagenticConfig: action.payload };
}

function chatroomActiveSpeaker(
  _state: AppState,
  action: Extract<AppAction, { type: 'CHATROOM_ACTIVE_SPEAKER' }>,
): Partial<AppState> {
  return { chatroomActiveSpeaker: action.payload };
}

function setChatroomDisabledMindIds(
  _state: AppState,
  action: Extract<AppAction, { type: 'SET_CHATROOM_DISABLED_MIND_IDS' }>,
): Partial<AppState> {
  return { chatroomDisabledMindIds: action.payload };
}

function setChatroomSessions(
  state: AppState,
  action: Extract<AppAction, { type: 'SET_CHATROOM_SESSIONS' }>,
): Partial<AppState> {
  // If the active session is gone from the list (deleted in another window),
  // clear the active marker so the panel falls back to the picker. The
  // transcript/ledger persist until an explicit CLEAR / RESUME action.
  const stillActive = state.activeChatroomSessionId
    ? action.payload.some((s) => s.sessionId === state.activeChatroomSessionId)
    : false;
  return {
    chatroomSessions: action.payload,
    ...(state.activeChatroomSessionId && !stillActive ? { activeChatroomSessionId: null } : {}),
  };
}

function resumeChatroomSession(
  _state: AppState,
  action: Extract<AppAction, { type: 'RESUME_CHATROOM_SESSION' }>,
): Partial<AppState> {
  return {
    chatroomSessions: action.payload.sessions,
    activeChatroomSessionId: action.payload.session.sessionId,
    chatroomMessages: action.payload.messages,
    chatroomTaskLedger: action.payload.taskLedger,
    chatroomStreamingByMind: {},
    chatroomActiveSpeaker: null,
    chatroomMetrics: null,
  };
}

function clearActiveChatroomSession(): Partial<AppState> {
  // Used when the active session is deleted or the user backs out to the
  // session-picker empty state. Mirrors CHATROOM_CLEAR's wipe of in-flight
  // view state but additionally drops the active id.
  return {
    activeChatroomSessionId: null,
    chatroomMessages: [],
    chatroomStreamingByMind: {},
    chatroomActiveSpeaker: null,
    chatroomTaskLedger: [],
    chatroomMetrics: null,
  };
}

export const chatroomHandlers: {
  SET_CHATROOM_HISTORY: Handler<'SET_CHATROOM_HISTORY'>;
  CHATROOM_USER_MESSAGE: Handler<'CHATROOM_USER_MESSAGE'>;
  CHATROOM_AGENT_MESSAGE: Handler<'CHATROOM_AGENT_MESSAGE'>;
  CHATROOM_EVENT: Handler<'CHATROOM_EVENT'>;
  CHATROOM_CLEAR: Handler<'CHATROOM_CLEAR'>;
  SET_CHATROOM_TASK_LEDGER: Handler<'SET_CHATROOM_TASK_LEDGER'>;
  SET_ORCHESTRATION: Handler<'SET_ORCHESTRATION'>;
  SET_GROUP_CHAT_CONFIG: Handler<'SET_GROUP_CHAT_CONFIG'>;
  SET_HANDOFF_CONFIG: Handler<'SET_HANDOFF_CONFIG'>;
  SET_MAGENTIC_CONFIG: Handler<'SET_MAGENTIC_CONFIG'>;
  CHATROOM_ACTIVE_SPEAKER: Handler<'CHATROOM_ACTIVE_SPEAKER'>;
  SET_CHATROOM_DISABLED_MIND_IDS: Handler<'SET_CHATROOM_DISABLED_MIND_IDS'>;
  SET_CHATROOM_SESSIONS: Handler<'SET_CHATROOM_SESSIONS'>;
  RESUME_CHATROOM_SESSION: Handler<'RESUME_CHATROOM_SESSION'>;
  CLEAR_ACTIVE_CHATROOM_SESSION: Handler<'CLEAR_ACTIVE_CHATROOM_SESSION'>;
} = {
  SET_CHATROOM_HISTORY: setChatroomHistory,
  CHATROOM_USER_MESSAGE: chatroomUserMessage,
  CHATROOM_AGENT_MESSAGE: chatroomAgentMessage,
  CHATROOM_EVENT: chatroomEvent,
  CHATROOM_CLEAR: chatroomClear,
  SET_CHATROOM_TASK_LEDGER: setChatroomTaskLedger,
  SET_ORCHESTRATION: setOrchestration,
  SET_GROUP_CHAT_CONFIG: setGroupChatConfig,
  SET_HANDOFF_CONFIG: setHandoffConfig,
  SET_MAGENTIC_CONFIG: setMagenticConfig,
  CHATROOM_ACTIVE_SPEAKER: chatroomActiveSpeaker,
  SET_CHATROOM_DISABLED_MIND_IDS: setChatroomDisabledMindIds,
  SET_CHATROOM_SESSIONS: setChatroomSessions,
  RESUME_CHATROOM_SESSION: resumeChatroomSession,
  CLEAR_ACTIVE_CHATROOM_SESSION: clearActiveChatroomSession,
};
