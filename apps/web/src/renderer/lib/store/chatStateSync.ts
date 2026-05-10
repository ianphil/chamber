import type { ChatMessage, ContentBlock } from '@chamber/shared/types';
import type { ConversationViewState } from './state';

export const CHAT_STATE_CHANNEL = 'chamber:chatState:v1';

export interface SyncedChatState {
  messagesByMind: Record<string, ChatMessage[]>;
  streamingByMind: Record<string, boolean>;
  conversationViewByMind?: Record<string, ConversationViewState>;
}

export type ChatStateSyncMessage =
  | { type: 'request-state' }
  | { type: 'state'; payload: SyncedChatState };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isContentBlock(value: unknown): value is ContentBlock {
  if (!isRecord(value) || typeof value.type !== 'string') return false;

  switch (value.type) {
    case 'text':
      return typeof value.content === 'string';
    case 'image':
      return typeof value.name === 'string' && typeof value.mimeType === 'string' && typeof value.dataUrl === 'string';
    case 'tool_call':
      return typeof value.toolCallId === 'string'
        && typeof value.toolName === 'string'
        && (value.status === 'running' || value.status === 'done' || value.status === 'error');
    case 'reasoning':
      return typeof value.reasoningId === 'string' && typeof value.content === 'string';
    default:
      return false;
  }
}

function isChatMessage(value: unknown): value is ChatMessage {
  return isRecord(value)
    && typeof value.id === 'string'
    && (value.role === 'user' || value.role === 'assistant')
    && Array.isArray(value.blocks)
    && value.blocks.every(isContentBlock)
    && typeof value.timestamp === 'number'
    && (value.isStreaming === undefined || typeof value.isStreaming === 'boolean');
}

function isMessagesByMind(value: unknown): value is Record<string, ChatMessage[]> {
  return isRecord(value)
    && Object.values(value).every((messages) => Array.isArray(messages) && messages.every(isChatMessage));
}

function isStreamingByMind(value: unknown): value is Record<string, boolean> {
  return isRecord(value)
    && Object.values(value).every((streaming) => typeof streaming === 'boolean');
}

function isConversationViewState(value: unknown): value is ConversationViewState {
  if (!isRecord(value)) return false;
  return (value.status === 'idle' || value.status === 'hydrating' || value.status === 'ready')
    && (value.sessionId === undefined || typeof value.sessionId === 'string')
    && (value.pendingSessionId === undefined || typeof value.pendingSessionId === 'string')
    && typeof value.streaming === 'boolean'
    && typeof value.modelSwitching === 'boolean'
    && (value.error === undefined || typeof value.error === 'string');
}

function isConversationViewByMind(value: unknown): value is Record<string, ConversationViewState> {
  return isRecord(value)
    && Object.values(value).every(isConversationViewState);
}

function isSyncedChatState(value: unknown): value is SyncedChatState {
  return isRecord(value)
    && isMessagesByMind(value.messagesByMind)
    && isStreamingByMind(value.streamingByMind)
    && (value.conversationViewByMind === undefined || isConversationViewByMind(value.conversationViewByMind));
}

export function parseChatStateSyncMessage(value: unknown): ChatStateSyncMessage | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null;

  if (value.type === 'request-state') return { type: 'request-state' };
  if (value.type === 'state' && isSyncedChatState(value.payload)) {
    return { type: 'state', payload: value.payload };
  }

  return null;
}

export function createChatStateSyncMessage(state: SyncedChatState): ChatStateSyncMessage {
  const payload: SyncedChatState = {
    messagesByMind: state.messagesByMind,
    streamingByMind: state.streamingByMind,
  };
  if (state.conversationViewByMind) {
    payload.conversationViewByMind = state.conversationViewByMind;
  }

  return {
    type: 'state',
    payload,
  };
}
