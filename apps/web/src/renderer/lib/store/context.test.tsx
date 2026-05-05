/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { makeMessage, makeTextBlock } from '../../../test/helpers';
import { AppStateProvider, useAppState } from './context';
import { CHAT_STATE_STORAGE_KEY, serializeChatState } from './chatStatePersistence';

function ChatStateProbe() {
  const { messagesByMind } = useAppState();
  const message = messagesByMind['mind-1']?.[0];
  const text = message?.blocks[0]?.type === 'text' ? message.blocks[0].content : 'empty';
  return <div>{text}</div>;
}

describe('AppStateProvider chat persistence', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('hydrates messages for a newly opened renderer window', () => {
    localStorage.setItem(CHAT_STATE_STORAGE_KEY, serializeChatState({
      messagesByMind: {
        'mind-1': [makeMessage([makeTextBlock('existing conversation')], { id: 'msg-1' })],
      },
      streamingByMind: {},
    }));

    render(<AppStateProvider><ChatStateProbe /></AppStateProvider>);

    expect(screen.getByText('existing conversation')).toBeTruthy();
  });

  it('receives chat state updates written by another renderer window', async () => {
    render(<AppStateProvider><ChatStateProbe /></AppStateProvider>);
    expect(screen.getByText('empty')).toBeTruthy();

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', {
        key: CHAT_STATE_STORAGE_KEY,
        newValue: serializeChatState({
          messagesByMind: {
            'mind-1': [makeMessage([makeTextBlock('returned conversation')], { id: 'msg-1' })],
          },
          streamingByMind: {},
        }),
      }));
    });

    await waitFor(() => {
      expect(screen.getByText('returned conversation')).toBeTruthy();
    });
  });
});
