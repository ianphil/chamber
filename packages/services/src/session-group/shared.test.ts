import { describe, it, expect } from 'vitest';

import { textContent, extractJsonObject, stripControlJson } from './shared';
import type { ChatroomMessage } from '@chamber/shared/chatroom-types';

function msg(blocks: ChatroomMessage['blocks']): ChatroomMessage {
  return {
    id: 'test-msg',
    role: 'assistant',
    blocks,
    timestamp: Date.now(),
    sender: { mindId: 'test', name: 'Test' },
    roundId: 'r1',
  };
}

describe('textContent', () => {
  it('extracts content from a single text block', () => {
    const m = msg([{ type: 'text', content: 'hello' }]);
    expect(textContent(m)).toBe('hello');
  });

  it('joins content from multiple text blocks', () => {
    const m = msg([
      { type: 'text', content: 'hello ' },
      { type: 'text', content: 'world' },
    ]);
    expect(textContent(m)).toBe('hello world');
  });

  it('extracts only text blocks from mixed block types', () => {
    const m = msg([
      { type: 'text', content: 'before ' },
      { type: 'tool_call', toolCallId: 'tc1', toolName: 'grep', status: 'done' },
      { type: 'text', content: 'after' },
    ]);
    expect(textContent(m)).toBe('before after');
  });

  it('returns empty string when there are no text blocks', () => {
    const m = msg([
      { type: 'tool_call', toolCallId: 'tc1', toolName: 'grep', status: 'done' },
      { type: 'reasoning', reasoningId: 'r1', content: 'thinking...' },
    ]);
    expect(textContent(m)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// extractJsonObject
// ---------------------------------------------------------------------------

describe('extractJsonObject', () => {
  it('extracts a simple JSON object', () => {
    expect(extractJsonObject('{"action":"stop"}')).toBe('{"action":"stop"}');
  });

  it('extracts nested JSON objects', () => {
    const input = '{"a":{"b":{"c":1}}}';
    expect(extractJsonObject(input)).toBe(input);
  });

  it('returns null when there is no JSON', () => {
    expect(extractJsonObject('just plain text')).toBeNull();
  });

  it('extracts JSON preceded by text', () => {
    expect(extractJsonObject('some preamble {"action":"go"}')).toBe('{"action":"go"}');
  });

  it('handles braces inside string values', () => {
    const input = '{"content":"use { braces }"}';
    expect(extractJsonObject(input)).toBe(input);
  });

  it('returns null for an unclosed object', () => {
    expect(extractJsonObject('{"action":"stop"')).toBeNull();
  });

  it('handles escaped quotes inside strings', () => {
    const input = '{"msg":"she said \\"hi\\""}';
    expect(extractJsonObject(input)).toBe(input);
  });
});

// ---------------------------------------------------------------------------
// stripControlJson
// ---------------------------------------------------------------------------

describe('stripControlJson', () => {
  const isStop = (action: unknown) => action === 'stop';

  it('strips matching control action', () => {
    const text = 'prefix {"action":"stop"} suffix';
    expect(stripControlJson(text, isStop)).toBe('prefix  suffix');
  });

  it('leaves text when action does not match predicate', () => {
    const text = '{"action":"continue"}';
    expect(stripControlJson(text, isStop)).toBe('{"action":"continue"}');
  });

  it('leaves text when no JSON is present', () => {
    expect(stripControlJson('no json here', isStop)).toBe('no json here');
  });

  it('handles invalid JSON gracefully', () => {
    const text = '{not valid json}';
    expect(stripControlJson(text, isStop)).toBe('{not valid json}');
  });

  it('trims whitespace after stripping', () => {
    const text = '   {"action":"stop"}   ';
    expect(stripControlJson(text, isStop)).toBe('');
  });
});
