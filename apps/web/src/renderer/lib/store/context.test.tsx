/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeMessage, makeTextBlock } from '../../../test/helpers';
import { AppStateProvider, useAppState } from './context';
import { CHAT_STATE_CHANNEL, createChatStateSyncMessage } from './chatStateSync';

class FakeBroadcastChannel {
  static channels = new Map<string, Set<FakeBroadcastChannel>>();

  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(public readonly name: string) {
    const channels = FakeBroadcastChannel.channels.get(name) ?? new Set<FakeBroadcastChannel>();
    channels.add(this);
    FakeBroadcastChannel.channels.set(name, channels);
  }

  postMessage(data: unknown): void {
    for (const channel of FakeBroadcastChannel.channels.get(this.name) ?? []) {
      if (channel === this) continue;
      channel.onmessage?.({ data } as MessageEvent);
    }
  }

  close(): void {
    FakeBroadcastChannel.channels.get(this.name)?.delete(this);
  }
}

function ChatStateProbe() {
  const { messagesByMind } = useAppState();
  const message = messagesByMind['mind-1']?.[0];
  const text = message?.blocks[0]?.type === 'text' ? message.blocks[0].content : 'empty';
  return <div>{text}</div>;
}

describe('AppStateProvider chat sync', () => {
  beforeEach(() => {
    FakeBroadcastChannel.channels.clear();
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('requests messages for a newly opened renderer window', async () => {
    const remote = new BroadcastChannel(CHAT_STATE_CHANNEL);
    remote.onmessage = (event) => {
      if (event.data?.type !== 'request-state') return;
      remote.postMessage(createChatStateSyncMessage({
        messagesByMind: {
          'mind-1': [makeMessage([makeTextBlock('existing conversation')], { id: 'msg-1' })],
        },
        streamingByMind: {},
      }));
    };

    render(<AppStateProvider><ChatStateProbe /></AppStateProvider>);

    await waitFor(() => {
      expect(screen.getByText('existing conversation')).toBeTruthy();
    });
  });

  it('receives chat state updates written by another renderer window', async () => {
    const remote = new BroadcastChannel(CHAT_STATE_CHANNEL);
    render(<AppStateProvider><ChatStateProbe /></AppStateProvider>);
    expect(screen.getByText('empty')).toBeTruthy();

    act(() => {
      remote.postMessage(createChatStateSyncMessage({
        messagesByMind: {
          'mind-1': [makeMessage([makeTextBlock('returned conversation')], { id: 'msg-1' })],
        },
        streamingByMind: {},
      }));
    });

    await waitFor(() => {
      expect(screen.getByText('returned conversation')).toBeTruthy();
    });
  });
});
