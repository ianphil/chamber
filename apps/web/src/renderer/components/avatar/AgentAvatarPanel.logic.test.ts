import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@chamber/shared/types';
import {
  deriveAvatarState,
  getSpeechBubbleText,
  stripMarkdownForSpeech,
  takeSpeakableText,
} from './AgentAvatarPanel.logic';

function message(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: overrides.id ?? 'm1',
    role: overrides.role ?? 'assistant',
    blocks: overrides.blocks ?? [],
    timestamp: overrides.timestamp ?? 0,
    isStreaming: overrides.isStreaming,
  };
}

describe('AgentAvatarPanel logic', () => {
  it('stays idle when chat is not streaming', () => {
    const messages = [
      message({
        blocks: [{ type: 'text', content: 'Done.' }],
        isStreaming: false,
      }),
    ];

    expect(deriveAvatarState(messages, false)).toBe('idle');
  });

  it('shows listening when a user message is waiting for an assistant placeholder', () => {
    const messages = [
      message({
        role: 'user',
        blocks: [{ type: 'text', content: 'Hello' }],
      }),
    ];

    expect(deriveAvatarState(messages, true)).toBe('listening');
  });

  it('shows thinking for an empty streaming assistant message', () => {
    const messages = [message({ isStreaming: true })];

    expect(deriveAvatarState(messages, true)).toBe('thinking');
  });

  it('shows speaking when assistant text is streaming', () => {
    const messages = [
      message({
        isStreaming: true,
        blocks: [{ type: 'text', content: 'Working on it.' }],
      }),
    ];

    expect(deriveAvatarState(messages, true)).toBe('speaking');
  });

  it('clips speech bubble text to the latest assistant response tail', () => {
    const messages = [
      message({
        blocks: [{ type: 'text', content: 'First response.' }],
      }),
      message({
        id: 'm2',
        blocks: [{ type: 'text', content: 'This is the latest response that should be visible in the speech bubble.' }],
      }),
    ];

    expect(getSpeechBubbleText(messages, 38)).toBe('be visible in the speech bubble.');
  });

  it('extracts complete speakable sentences from streaming deltas', () => {
    expect(takeSpeakableText('This is ready. This is not yet')?.text).toBe('This is ready.');
    expect(takeSpeakableText('No sentence yet')).toBeNull();
  });

  it('strips markdown before silent lip-sync speech', () => {
    expect(stripMarkdownForSpeech('## Hello [there](https://example.com), `friend`!')).toBe('Hello there, friend!');
  });
});
