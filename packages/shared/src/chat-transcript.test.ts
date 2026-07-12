import { describe, it, expect } from 'vitest';
import type { ChatMessage } from './types';
import { applyChatEventToMessage } from './chat-transcript';

function assistant(): ChatMessage {
  return { id: 'm1', role: 'assistant', blocks: [], timestamp: 0 };
}

describe('applyChatEventToMessage', () => {
  it('appends and extends text blocks from chunks', () => {
    let message = applyChatEventToMessage(assistant(), { type: 'chunk', content: 'Hel', sdkMessageId: 's1' });
    message = applyChatEventToMessage(message, { type: 'chunk', content: 'lo', sdkMessageId: 's1' });
    expect(message.blocks).toEqual([{ type: 'text', sdkMessageId: 's1', content: 'Hello' }]);
  });

  it('creates a running tool block and resolves it on tool_done', () => {
    let message = applyChatEventToMessage(assistant(), { type: 'tool_start', toolCallId: 't1', toolName: 'grep', args: { q: 'x' } });
    expect(message.blocks[0]).toMatchObject({ type: 'tool_call', status: 'running' });
    message = applyChatEventToMessage(message, { type: 'tool_done', toolCallId: 't1', success: true, result: 'match' });
    expect(message.blocks[0]).toMatchObject({ type: 'tool_call', status: 'done', output: 'match' });
  });

  it('records reasoning and coalesces same-id reasoning deltas', () => {
    let message = applyChatEventToMessage(assistant(), { type: 'reasoning', reasoningId: 'r1', content: 'think ' });
    message = applyChatEventToMessage(message, { type: 'reasoning', reasoningId: 'r1', content: 'more' });
    expect(message.blocks).toEqual([{ type: 'reasoning', reasoningId: 'r1', content: 'think more' }]);
  });

  it('adds a permission block and updates its outcome, ignoring duplicate requests', () => {
    let message = applyChatEventToMessage(assistant(), { type: 'permission_request', requestId: 'p1', kind: 'shell', summary: 'ls', toolCallId: 't1' });
    const afterDuplicate = applyChatEventToMessage(message, { type: 'permission_request', requestId: 'p1', kind: 'shell', summary: 'ls' });
    expect(afterDuplicate).toBe(message);
    message = applyChatEventToMessage(message, { type: 'permission_outcome', requestId: 'p1', outcome: 'approved' });
    expect(message.blocks[0]).toMatchObject({ type: 'permission', requestId: 'p1', outcome: 'approved' });
  });

  it('does not mutate the input message', () => {
    const original = assistant();
    const next = applyChatEventToMessage(original, { type: 'chunk', content: 'x' });
    expect(original.blocks).toEqual([]);
    expect(next).not.toBe(original);
  });
});
