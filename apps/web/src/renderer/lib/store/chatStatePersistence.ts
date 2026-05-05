import type { ChatMessage, ContentBlock } from '@chamber/shared/types';
import type { AppState } from './state';

export const CHAT_STATE_STORAGE_KEY = 'chamber:chatState:v1';

export interface PersistedChatState {
  messagesByMind: Record<string, ChatMessage[]>;
  streamingByMind: Record<string, boolean>;
}

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
      return typeof value.toolCallId === 'string' && typeof value.toolName === 'string' && typeof value.status === 'string';
    case 'reasoning':
      return typeof value.content === 'string';
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

export function parsePersistedChatState(raw: string | null): PersistedChatState | null {
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    if (!isMessagesByMind(parsed.messagesByMind)) return null;
    if (!isStreamingByMind(parsed.streamingByMind)) return null;
    return {
      messagesByMind: parsed.messagesByMind,
      streamingByMind: parsed.streamingByMind,
    };
  } catch {
    return null;
  }
}

export function serializeChatState(state: Pick<AppState, 'messagesByMind' | 'streamingByMind'>): string {
  return JSON.stringify({
    messagesByMind: state.messagesByMind,
    streamingByMind: state.streamingByMind,
  } satisfies PersistedChatState);
}

