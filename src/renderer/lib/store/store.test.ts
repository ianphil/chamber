/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { getPlainContent } from '.';
import { makeMessage } from '../../../test/helpers';

describe('getPlainContent', () => {
  it('extracts text from text blocks', () => {
    const msg = makeMessage([
      { type: 'text', content: 'Hello ' },
      { type: 'text', content: 'world' },
    ]);
    expect(getPlainContent(msg)).toBe('Hello world');
  });

  it('ignores non-text blocks', () => {
    const msg = makeMessage([
      { type: 'text', content: 'visible' },
      { type: 'tool_call', toolCallId: 'tc1', toolName: 'grep', status: 'done' },
      { type: 'reasoning', reasoningId: 'r1', content: 'thinking...' },
    ]);
    expect(getPlainContent(msg)).toBe('visible');
  });

  it('returns empty string for message with no text blocks', () => {
    const msg = makeMessage([
      { type: 'tool_call', toolCallId: 'tc1', toolName: 'grep', status: 'running' },
    ]);
    expect(getPlainContent(msg)).toBe('');
  });

  it('returns empty string for message with empty blocks', () => {
    const msg = makeMessage([]);
    expect(getPlainContent(msg)).toBe('');
  });
});
