import type { AppState, AppAction } from '../state';
import { parseModelSelectionKey } from '@chamber/shared/model-selection';
import { selectedModelForActiveMind } from './helpers';

type Handler<T extends AppAction['type']> = (
  state: AppState,
  action: Extract<AppAction, { type: T }>,
) => Partial<AppState> | AppState;

function setMinds(state: AppState, action: Extract<AppAction, { type: 'SET_MINDS' }>): Partial<AppState> {
  return {
    minds: action.payload,
    selectedModel: selectedModelForActiveMind(state, state.activeMindId, action.payload),
  };
}

function setAgentProfileSummary(
  state: AppState,
  action: Extract<AppAction, { type: 'SET_AGENT_PROFILE_SUMMARY' }>,
): Partial<AppState> {
  return {
    agentProfileByMindId: {
      ...state.agentProfileByMindId,
      [action.payload.mindId]: action.payload,
    },
  };
}

function setActiveMind(state: AppState, action: Extract<AppAction, { type: 'SET_ACTIVE_MIND' }>): Partial<AppState> {
  return {
    activeMindId: action.payload,
    selectedModel: selectedModelForActiveMind(state, action.payload),
    isStreaming: action.payload
      ? Boolean(state.streamingByMind[action.payload] || state.conversationViewByMind[action.payload]?.streaming)
      : false,
  };
}

function addMind(state: AppState, action: Extract<AppAction, { type: 'ADD_MIND' }>): Partial<AppState> | AppState {
  const exists = state.minds.some((m) => m.mindId === action.payload.mindId);
  if (exists) return state;
  return {
    minds: [...state.minds, action.payload],
    activeMindId: state.activeMindId ?? action.payload.mindId,
  };
}

function removeMind(state: AppState, action: Extract<AppAction, { type: 'REMOVE_MIND' }>): Partial<AppState> {
  const newMinds = state.minds.filter((m) => m.mindId !== action.payload);
  const newMsgsByMind = { ...state.messagesByMind };
  const newConversationHistoryByMind = { ...state.conversationHistoryByMind };
  const newActiveConversationByMind = { ...state.activeConversationByMind };
  const newConversationViewByMind = { ...state.conversationViewByMind };
  const newComposeDraftByMind = { ...state.composeDraftByMind };
  const newA2aStreamingByMind = { ...state.a2aStreamingByMind };
  const newAgentProfileByMindId = { ...state.agentProfileByMindId };
  delete newMsgsByMind[action.payload];
  delete newConversationHistoryByMind[action.payload];
  delete newActiveConversationByMind[action.payload];
  delete newConversationViewByMind[action.payload];
  delete newComposeDraftByMind[action.payload];
  delete newA2aStreamingByMind[action.payload];
  delete newAgentProfileByMindId[action.payload];
  const newActive = state.activeMindId === action.payload
    ? (newMinds.length > 0 ? newMinds[0].mindId : null)
    : state.activeMindId;
  return {
    minds: newMinds,
    activeMindId: newActive,
    messagesByMind: newMsgsByMind,
    conversationHistoryByMind: newConversationHistoryByMind,
    activeConversationByMind: newActiveConversationByMind,
    conversationViewByMind: newConversationViewByMind,
    composeDraftByMind: newComposeDraftByMind,
    a2aStreamingByMind: newA2aStreamingByMind,
    agentProfileByMindId: newAgentProfileByMindId,
    showLanding: newMinds.length === 0,
  };
}

function setAvailableModels(
  state: AppState,
  action: Extract<AppAction, { type: 'SET_AVAILABLE_MODELS' }>,
): Partial<AppState> {
  const nextState: AppState = { ...state, availableModels: action.payload };
  return {
    availableModels: action.payload,
    selectedModel: selectedModelForActiveMind(nextState, nextState.activeMindId),
  };
}

function setSelectedModel(
  state: AppState,
  action: Extract<AppAction, { type: 'SET_SELECTED_MODEL' }>,
): Partial<AppState> | AppState {
  const selection = parseModelSelectionKey(action.payload);
  const activeMind = state.activeMindId
    ? state.minds.find((mind) => mind.mindId === state.activeMindId)
    : undefined;
  if (
    state.selectedModel === action.payload &&
    (!activeMind || (
      activeMind.selectedModel === selection?.id
      && activeMind.selectedModelProvider === selection?.provider
    ))
  ) {
    return state;
  }
  return {
    selectedModel: action.payload,
    minds: state.activeMindId
        ? state.minds.map((mind) =>
            mind.mindId === state.activeMindId
              ? {
                  ...mind,
                  selectedModel: selection?.id,
                  selectedModelProvider: selection?.provider,
                }
              : mind,
          )
      : state.minds,
  };
}

function mindsChecked(): Partial<AppState> {
  return { mindsChecked: true };
}

export const mindsHandlers: {
  SET_MINDS: Handler<'SET_MINDS'>;
  SET_AGENT_PROFILE_SUMMARY: Handler<'SET_AGENT_PROFILE_SUMMARY'>;
  SET_ACTIVE_MIND: Handler<'SET_ACTIVE_MIND'>;
  ADD_MIND: Handler<'ADD_MIND'>;
  REMOVE_MIND: Handler<'REMOVE_MIND'>;
  SET_AVAILABLE_MODELS: Handler<'SET_AVAILABLE_MODELS'>;
  SET_SELECTED_MODEL: Handler<'SET_SELECTED_MODEL'>;
  MINDS_CHECKED: Handler<'MINDS_CHECKED'>;
} = {
  SET_MINDS: setMinds,
  SET_AGENT_PROFILE_SUMMARY: setAgentProfileSummary,
  SET_ACTIVE_MIND: setActiveMind,
  ADD_MIND: addMind,
  REMOVE_MIND: removeMind,
  SET_AVAILABLE_MODELS: setAvailableModels,
  SET_SELECTED_MODEL: setSelectedModel,
  MINDS_CHECKED: mindsChecked,
};
