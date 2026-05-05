/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { makeMessage, makeTextBlock } from '../../../test/helpers';
import { createChatStateSyncMessage, parseChatStateSyncMessage } from './chatStateSync';

describe('chatStateSync', () => {
  it('round-trips chat messages and streaming state by mind', () => {
    const message = makeMessage([makeTextBlock('hello')], { id: 'msg-1' });
    const syncMessage = createChatStateSyncMessage({
      messagesByMind: { 'mind-1': [message] },
      streamingByMind: { 'mind-1': true },
    });

    expect(parseChatStateSyncMessage(syncMessage)).toEqual({
      type: 'state',
      payload: {
        messagesByMind: { 'mind-1': [message] },
        streamingByMind: { 'mind-1': true },
      },
    });
  });

  it('rejects malformed sync messages', () => {
    expect(parseChatStateSyncMessage({ type: 'state', payload: { messagesByMind: { 'mind-1': [{ id: 'msg-1' }] }, streamingByMind: {} } })).toBeNull();
    expect(parseChatStateSyncMessage({ type: 'unknown' })).toBeNull();
  });

  it('rejects unsound tool and reasoning blocks', () => {
    expect(parseChatStateSyncMessage({
      type: 'state',
      payload: {
        messagesByMind: {
          'mind-1': [{
            id: 'msg-1',
            role: 'assistant',
            blocks: [{ type: 'tool_call', toolCallId: 'tool-1', toolName: 'grep', status: 'pending' }],
            timestamp: 1000,
          }],
        },
        streamingByMind: {},
      },
    })).toBeNull();

    expect(parseChatStateSyncMessage({
      type: 'state',
      payload: {
        messagesByMind: {
          'mind-1': [{
            id: 'msg-1',
            role: 'assistant',
            blocks: [{ type: 'reasoning', content: 'thinking' }],
            timestamp: 1000,
          }],
        },
        streamingByMind: {},
      },
    })).toBeNull();
  });
});
