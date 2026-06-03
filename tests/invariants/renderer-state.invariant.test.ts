import { describe, it, expect } from 'vitest';
import { appReducer } from '../../apps/web/src/renderer/lib/store/reducers';
import { initialState, type AppState } from '../../apps/web/src/renderer/lib/store/state';
import type { Message } from '@chamber/shared/a2a-types';

const mindId = 'mind-a';

const withActiveMind: AppState = {
  ...initialState,
  minds: [{
    mindId,
    mindPath: 'C:\\agents\\a',
    identity: { name: 'Agent A', systemMessage: '' },
    status: 'ready',
  }],
  activeMindId: mindId,
};

describe('renderer state invariants', () => {
  it('unsent compose drafts are scoped per mind and clearing one mind preserves the others', () => {
    let state = appReducer(withActiveMind, {
      type: 'SET_COMPOSE_DRAFT',
      payload: { mindId: 'mind-a', draft: 'alpha draft' },
    });
    state = appReducer(state, {
      type: 'SET_COMPOSE_DRAFT',
      payload: { mindId: 'mind-b', draft: 'beta draft' },
    });

    expect(state.composeDraftByMind).toEqual({
      'mind-a': 'alpha draft',
      'mind-b': 'beta draft',
    });

    state = appReducer(state, {
      type: 'SET_COMPOSE_DRAFT',
      payload: { mindId: 'mind-b', draft: '' },
    });

    expect(state.composeDraftByMind).toEqual({ 'mind-a': 'alpha draft' });
  });

  it('sending a user message clears only the active mind draft', () => {
    const state = appReducer({
      ...withActiveMind,
      composeDraftByMind: {
        [mindId]: 'about to send',
        'other-mind': 'still typing elsewhere',
      },
    }, {
      type: 'ADD_USER_MESSAGE',
      payload: { id: 'u1', content: 'about to send', timestamp: 1 },
    });

    expect(state.composeDraftByMind).toEqual({ 'other-mind': 'still typing elsewhere' });
  });

  it('inbound A2A messages keep sender attribution instead of rendering as You', () => {
    const message: Message = {
      messageId: 'msg-a2a-1',
      role: 'ROLE_USER',
      parts: [{ text: 'Inspect the demo transcript.' }],
      metadata: { fromId: 'ernest-1234', fromName: 'Ernest', hopCount: 1 },
    };

    const state = appReducer(withActiveMind, {
      type: 'A2A_INCOMING',
      payload: { targetMindId: mindId, message, replyMessageId: 'reply-a2a-1' },
    });

    const messages = state.messagesByMind[mindId] ?? [];
    expect(messages[0]).toMatchObject({
      role: 'user',
      sender: { mindId: 'ernest-1234', name: 'Ernest' },
      blocks: [{ type: 'text', content: 'Inspect the demo transcript.' }],
    });
    expect(messages[0].sender).not.toEqual({ mindId: 'user', name: 'You' });
    expect(messages[1]).toMatchObject({
      id: 'reply-a2a-1',
      role: 'assistant',
      isStreaming: true,
    });
  });
});
