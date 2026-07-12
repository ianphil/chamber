import { modelSelectionEqualsModel, modelSelectionKey, modelSelectionKeyFromModel } from '@chamber/shared/model-selection';
import type { ChatEvent, ChatMessage, ContentBlock, ConversationSummary } from '@chamber/shared/types';
import { applyChatEventToMessage } from '@chamber/shared';
import type { AppState, ConversationViewState } from '../state';

export function nonEmptyString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

export function selectedModelForActiveMind(
  state: AppState,
  activeMindId: string | null,
  minds = state.minds,
): string | null {
  if (!activeMindId) return null;
  const mind = minds.find((candidate) => candidate.mindId === activeMindId);
  const selection = mind?.selectedModel
    ? { id: mind.selectedModel, provider: mind.selectedModelProvider }
    : null;
  if (
    selection
    && (state.availableModels.length === 0 || state.availableModels.some((model) => modelSelectionEqualsModel(selection, model)))
  ) {
    return modelSelectionKey(selection);
  }

  return state.availableModels[0] ? modelSelectionKeyFromModel(state.availableModels[0]) : null;
}

export function defaultConversationView(): ConversationViewState {
  return { status: 'idle', streaming: false, modelSwitching: false };
}

export function conversationViewFor(state: AppState, mindId: string): ConversationViewState {
  return state.conversationViewByMind[mindId] ?? defaultConversationView();
}

export function isMindChatStreaming(
  state: AppState,
  mindId: string,
  streamingByMind = state.streamingByMind,
  conversationViewByMind = state.conversationViewByMind,
): boolean {
  return Boolean(streamingByMind[mindId] || conversationViewByMind[mindId]?.streaming);
}

export function setConversationView(
  state: AppState,
  mindId: string,
  patch: Partial<ConversationViewState>,
): Record<string, ConversationViewState> {
  return {
    ...state.conversationViewByMind,
    [mindId]: {
      ...conversationViewFor(state, mindId),
      ...patch,
    },
  };
}

export function mergeConversationSummaries(
  existing: ConversationSummary[] | undefined,
  incoming: ConversationSummary[],
): ConversationSummary[] {
  if (!existing?.length) return incoming;
  const existingById = new Map(existing.map((conversation) => [conversation.sessionId, conversation]));
  return incoming.map((conversation) => {
    const current = existingById.get(conversation.sessionId);
    if (!current) return conversation;
    if (isPlaceholderConversationTitle(current.title) && !isPlaceholderConversationTitle(conversation.title)) {
      return conversation;
    }
    const currentUpdatedAt = Date.parse(current.updatedAt);
    const incomingUpdatedAt = Date.parse(conversation.updatedAt);
    if (Number.isNaN(currentUpdatedAt) || Number.isNaN(incomingUpdatedAt)) return conversation;
    return currentUpdatedAt > incomingUpdatedAt ? current : conversation;
  });
}

function isPlaceholderConversationTitle(title: string): boolean {
  return title === 'New chat' || title.startsWith('New chat · ');
}

export function getPlainContent(message: ChatMessage): string {
  return message.blocks
    .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.content)
    .join('');
}

export function handleChatEvent<T extends ChatMessage>(messages: T[], messageId: string, event: ChatEvent): T[] {
  return messages.map((m) => (m.id === messageId ? (applyChatEventToMessage(m, event) as T) : m));
}
