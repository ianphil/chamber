/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { makeMessage, makeTextBlock } from '../../../test/helpers';
import { parsePersistedChatState, serializeChatState } from './chatStatePersistence';

describe('chatStatePersistence', () => {
  it('round-trips chat messages and streaming state by mind', () => {
    const message = makeMessage([makeTextBlock('hello')], { id: 'msg-1' });
    const raw = serializeChatState({
      messagesByMind: {
        'mind-1': [message],
      },
      streamingByMind: { 'mind-1': true },
    });

    expect(parsePersistedChatState(raw)).toEqual({
      messagesByMind: {
        'mind-1': [message],
      },
      streamingByMind: { 'mind-1': true },
    });
  });

  it('rejects malformed stored chat state', () => {
    expect(parsePersistedChatState('{"messagesByMind":{"mind-1":[{"id":"msg-1"}]},"streamingByMind":{}}')).toBeNull();
    expect(parsePersistedChatState('not json')).toBeNull();
  });
});
