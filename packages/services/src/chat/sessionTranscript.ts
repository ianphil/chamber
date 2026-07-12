// Maps a persisted SDK session transcript (session.getEvents()) into the
// ChatMessage[] shape the renderer uses for live chat. Reusing the same
// ChatEvent fold (applyChatEventToMessage) and the same SDK event parsers as
// live streaming keeps a resumed, exported, or searched conversation visually
// identical to the live timeline, including tool calls, reasoning, and
// permission prompts rather than plain text only.

import type { ChatEvent, ChatMessage } from '@chamber/shared/types';
import { applyChatEventToMessage } from '@chamber/shared';
import { Logger } from '../logger';
import { stripInjectedCurrentDateTimeContext } from './currentDateTimeContext';
import {
  mapSdkPermissionCompleted,
  mapSdkPermissionRequested,
  mapSdkToolExecutionComplete,
  mapSdkToolExecutionStart,
} from '../sdk/sdkChatEventMapper';

const log = Logger.create('sessionTranscript');

interface RawSessionEvent {
  type?: string;
  timestamp?: unknown;
  id?: string;
  data?: Record<string, unknown>;
}

/**
 * Fold a persisted session event log into ordered ChatMessages. User messages
 * start a new turn; every assistant-side event (text, reasoning, tool call,
 * permission) until the next user message accumulates into a single assistant
 * message, mirroring how live chat renders one assistant bubble per turn.
 *
 * Malformed events are skipped rather than thrown: history assembly must stay
 * resilient so resume/export/search never fail on a single unexpected event,
 * unlike the live stream path which surfaces contract drift loudly.
 */
export function mapSessionEventsToChatMessages(events: readonly unknown[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  let assistant: ChatMessage | null = null;
  let assistantIdOverride: string | null = null;

  const flushAssistant = (): void => {
    if (assistant && assistant.blocks.length > 0) {
      messages.push(assistantIdOverride ? { ...assistant, id: assistantIdOverride } : assistant);
    }
    assistant = null;
    assistantIdOverride = null;
  };

  const foldIntoAssistant = (event: RawSessionEvent, index: number, chatEvent: ChatEvent | null): void => {
    if (!chatEvent) return;
    if (!assistant) {
      assistant = {
        id: assistantMessageId(event, index),
        role: 'assistant',
        blocks: [],
        timestamp: toTimestamp(event.timestamp),
      };
    }
    assistant = applyChatEventToMessage(assistant, chatEvent);
  };

  events.forEach((raw, index) => {
    if (typeof raw !== 'object' || raw === null) return;
    const event = raw as RawSessionEvent;
    const data = typeof event.data === 'object' && event.data !== null ? event.data : {};

    switch (event.type) {
      case 'user.message': {
        flushAssistant();
        const content = extractTextContent(data);
        if (!content) return;
        messages.push({
          id: messageId(data, event, index, 'user'),
          role: 'user',
          blocks: [{ type: 'text', content: stripInjectedCurrentDateTimeContext(content) }],
          timestamp: toTimestamp(event.timestamp),
        });
        return;
      }

      case 'assistant.reasoning': {
        const content = typeof data.content === 'string' ? data.content : '';
        if (!content) return;
        const reasoningId = typeof data.reasoningId === 'string' ? data.reasoningId : `reasoning-${index}`;
        foldIntoAssistant(event, index, { type: 'reasoning', reasoningId, content });
        return;
      }

      case 'assistant.message': {
        const content = extractTextContent(data);
        if (!content) return;
        const sdkMessageId = typeof data.messageId === 'string' ? data.messageId : `assistant-${index}`;
        // The assistant message id is the most meaningful identifier for the
        // whole turn; adopt the first one seen even if reasoning/tool events
        // opened the accumulator earlier with a synthesized id.
        if (assistantIdOverride === null && typeof data.messageId === 'string') {
          assistantIdOverride = data.messageId;
        }
        foldIntoAssistant(event, index, { type: 'message_final', sdkMessageId, content });
        return;
      }

      case 'tool.execution_start':
        foldIntoAssistant(event, index, safeMap('tool.execution_start', () => mapSdkToolExecutionStart(raw)));
        return;

      case 'tool.execution_complete':
        foldIntoAssistant(event, index, safeMap('tool.execution_complete', () => mapSdkToolExecutionComplete(raw)));
        return;

      case 'permission.requested':
        foldIntoAssistant(event, index, safeMap('permission.requested', () => mapSdkPermissionRequested(raw)));
        return;

      case 'permission.completed':
        foldIntoAssistant(event, index, safeMap('permission.completed', () => mapSdkPermissionCompleted(raw)));
        return;

      default:
        return;
    }
  });

  flushAssistant();
  return messages;
}

function safeMap<T extends ChatEvent>(eventName: string, map: () => T): T | null {
  try {
    return map();
  } catch (error) {
    log.warn(`Skipping malformed ${eventName} event while mapping session history:`, error);
    return null;
  }
}

function extractTextContent(data: Record<string, unknown>): string | null {
  const value = data.content ?? data.message ?? data.text ?? data.prompt;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const content = value
      .map((item) => {
        if (typeof item === 'string') return item;
        if (typeof item !== 'object' || item === null) return '';
        const block = item as Record<string, unknown>;
        return typeof block.text === 'string' ? block.text : '';
      })
      .filter(Boolean)
      .join('\n');
    return content || null;
  }
  return null;
}

function messageId(
  data: Record<string, unknown>,
  event: RawSessionEvent,
  index: number,
  role: 'user' | 'assistant',
): string {
  if (typeof data.messageId === 'string') return data.messageId;
  if (typeof event.id === 'string') return event.id;
  return `${role}-${index}`;
}

function assistantMessageId(event: RawSessionEvent, index: number): string {
  const data = typeof event.data === 'object' && event.data !== null ? event.data : {};
  return messageId(data, event, index, 'assistant');
}

function toTimestamp(value: unknown): number {
  if (typeof value === 'number') return value;
  const parsed = Date.parse(String(value ?? ''));
  return Number.isNaN(parsed) ? Date.now() : parsed;
}
