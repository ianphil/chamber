/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeMessage, makeTextBlock } from '../../../test/helpers';
import { AppStateProvider, useAppDispatch, useAppState } from './context';
import { CHAT_STATE_CHANNEL, createChatStateSyncMessage } from './chatStateSync';

class FakeBroadcastChannel {
  static channels = new Map<string, Set<FakeBroadcastChannel>>();
  static postMessageCalls = 0;

  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(public readonly name: string) {
    const channels = FakeBroadcastChannel.channels.get(name) ?? new Set<FakeBroadcastChannel>();
    channels.add(this);
    FakeBroadcastChannel.channels.set(name, channels);
  }

  postMessage(data: unknown): void {
    FakeBroadcastChannel.postMessageCalls += 1;
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

function ChunkAppender() {
  const dispatch = useAppDispatch();
  return (
    <button
      data-testid="append-chunk"
      onClick={() => {
        dispatch({
          type: 'CHAT_EVENT',
          payload: {
            mindId: 'mind-1',
            messageId: 'streaming-msg',
            event: { type: 'chunk', sdkMessageId: 'sdk-1', content: 'x' },
          },
        });
      }}
    >
      append
    </button>
  );
}

describe('AppStateProvider chat sync', () => {
  beforeEach(() => {
    FakeBroadcastChannel.channels.clear();
    FakeBroadcastChannel.postMessageCalls = 0;
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

  it('coalesces a burst of chat-event dispatches into a single BroadcastChannel postMessage per animation frame', async () => {
    const rafCallbacks: FrameRequestCallback[] = [];
    let nextRafId = 1;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return nextRafId++;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);

    render(
      <AppStateProvider>
        <ChunkAppender />
      </AppStateProvider>,
    );

    await waitFor(() => {
      const channels = FakeBroadcastChannel.channels.get(CHAT_STATE_CHANNEL);
      expect(channels && channels.size).toBeGreaterThan(0);
    });

    FakeBroadcastChannel.postMessageCalls = 0;
    rafCallbacks.length = 0;

    const append = screen.getByTestId('append-chunk');
    act(() => {
      append.click();
      append.click();
      append.click();
      append.click();
      append.click();
    });

    expect(FakeBroadcastChannel.postMessageCalls).toBe(0);

    act(() => {
      const pending = rafCallbacks.splice(0);
      for (const cb of pending) cb(performance.now());
    });

    expect(FakeBroadcastChannel.postMessageCalls).toBe(1);
  });

  it('flushes the pending state synchronously when the source window unmounts before the next animation frame', () => {
    let pendingRaf: FrameRequestCallback | null = null;
    let cancelled = false;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      pendingRaf = cb;
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {
      cancelled = true;
      pendingRaf = null;
    });

    const peer = new BroadcastChannel(CHAT_STATE_CHANNEL);
    let received: unknown = null;
    peer.onmessage = (event) => {
      if (event.data?.type === 'state') received = event.data;
    };

    const { unmount } = render(
      <AppStateProvider>
        <ChunkAppender />
      </AppStateProvider>,
    );

    act(() => {
      screen.getByTestId('append-chunk').click();
    });

    expect(pendingRaf).not.toBeNull();
    received = null;

    act(() => {
      unmount();
    });

    expect(cancelled).toBe(true);
    expect(received).not.toBeNull();
  });
});
