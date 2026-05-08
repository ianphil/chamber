import type { ChatMessage, ContentBlock } from '@chamber/shared/types';

export type AvatarPanelState = 'idle' | 'listening' | 'thinking' | 'speaking';

export interface LatestAssistantText {
  messageId: string;
  text: string;
  isStreaming: boolean;
}

export interface SpeakableText {
  text: string;
  consumed: number;
}

export function deriveAvatarState(messages: ChatMessage[], isStreaming: boolean): AvatarPanelState {
  if (!isStreaming) return 'idle';

  const lastMessage = messages[messages.length - 1];
  if (lastMessage?.role === 'user') return 'listening';

  const latestAssistant = getLatestAssistantText(messages);
  if (!latestAssistant || latestAssistant.text.trim().length === 0) {
    return 'thinking';
  }

  return 'speaking';
}

export function getLatestAssistantText(messages: ChatMessage[]): LatestAssistantText | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role === 'assistant') {
      return {
        messageId: message.id,
        text: getTextFromBlocks(message.blocks),
        isStreaming: Boolean(message.isStreaming),
      };
    }
  }

  return null;
}

export function getSpeechBubbleText(messages: ChatMessage[], maxLength = 220): string | null {
  const latestAssistant = getLatestAssistantText(messages);
  const text = latestAssistant?.text.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  if (text.length <= maxLength) return text;

  const tail = text.slice(-maxLength);
  const firstSpace = tail.indexOf(' ');
  return firstSpace >= 0 ? tail.slice(firstSpace + 1) : tail;
}

export function takeSpeakableText(text: string, maxChunkLength = 180): SpeakableText | null {
  const leadingWhitespace = text.length - text.trimStart().length;
  const candidate = text.slice(leadingWhitespace);
  if (candidate.length === 0) return null;

  const sentenceMatch = candidate.match(/^([\s\S]*?[.!?])(?:\s|$)/);
  if (sentenceMatch?.[1] && sentenceMatch[1].trim().length > 2) {
    const sentence = sentenceMatch[1];
    return {
      text: sentence,
      consumed: leadingWhitespace + sentence.length,
    };
  }

  if (candidate.length < maxChunkLength) return null;

  const chunk = candidate.slice(0, maxChunkLength);
  const lastSpace = chunk.lastIndexOf(' ');
  const end = lastSpace > 80 ? lastSpace : maxChunkLength;
  return {
    text: candidate.slice(0, end),
    consumed: leadingWhitespace + end,
  };
}

export function stripMarkdownForSpeech(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, ' code block ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#*_>~-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getTextFromBlocks(blocks: ContentBlock[]): string {
  return blocks
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.content)
    .join('');
}
