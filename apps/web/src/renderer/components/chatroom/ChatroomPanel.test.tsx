/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, type Mock } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ChatroomPanel } from './ChatroomPanel';
import { AppStateProvider } from '../../lib/store';
import type { AppState } from '../../lib/store';
import type { MindContext, ElectronAPI } from '@chamber/shared/types';
import {
  installElectronAPI,
  makeChatroomMessage,
} from '../../../test/helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MIND_A: MindContext = {
  mindId: 'mind-a',
  mindPath: 'C:\\agents\\a',
  identity: { name: 'The Dude', systemMessage: '' },
  status: 'ready',
};

const MIND_B: MindContext = {
  mindId: 'mind-b',
  mindPath: 'C:\\agents\\b',
  identity: { name: 'Jarvis', systemMessage: '' },
  status: 'ready',
};

function renderPanel(stateOverrides: Partial<AppState> = {}, api?: ElectronAPI) {
  const mock = installElectronAPI(api);
  return {
    mock,
    ...render(
      <AppStateProvider testInitialState={stateOverrides}>
        <ChatroomPanel />
      </AppStateProvider>,
    ),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChatroomPanel', () => {
  let api: ElectronAPI;

  beforeEach(() => {
    api = installElectronAPI();
  });

  // 1. Empty state with agents present
  it('renders empty state when no messages and agents are loaded', () => {
    renderPanel({ minds: [MIND_A] }, api);
    expect(screen.getByText(/multi-agent chatroom/i)).toBeTruthy();
  });

  // 2. Participant bar
  it('renders participant bar with loaded minds', () => {
    renderPanel({ minds: [MIND_A, MIND_B] }, api);
    expect(screen.getByText('The Dude')).toBeTruthy();
    expect(screen.getByText('Jarvis')).toBeTruthy();
  });

  // 3. User messages
  it('renders user messages with "You" sender badge', () => {
    const userMsg = makeChatroomMessage({
      id: 'u1',
      role: 'user',
      blocks: [{ type: 'text', content: 'hello everyone' }],
      sender: { mindId: 'user', name: 'You' },
    });
    renderPanel({ minds: [MIND_A], chatroomMessages: [userMsg] }, api);
    expect(screen.getByText('You')).toBeTruthy();
    expect(screen.getByText('hello everyone')).toBeTruthy();
  });

  // 4. Agent messages
  it('renders agent messages with agent name badge', () => {
    const agentMsg = makeChatroomMessage({
      id: 'a1',
      role: 'assistant',
      blocks: [{ type: 'text', content: 'hey there' }],
      sender: { mindId: 'mind-a', name: 'The Dude' },
    });
    renderPanel({ minds: [MIND_A], chatroomMessages: [agentMsg] }, api);
    // Sender name appears in the message header
    expect(screen.getAllByText('The Dude').length).toBeGreaterThanOrEqual(1);
  });

  // 5. Loads history on mount
  it('loads history on mount via chatroom.history()', async () => {
    const historyMsg = makeChatroomMessage({ id: 'h1' });
    (api.chatroom.history as Mock).mockResolvedValue([historyMsg]);

    await act(async () => {
      renderPanel({ minds: [MIND_A] }, api);
    });

    expect(api.chatroom.history).toHaveBeenCalled();
  });

  // 6. Sends message
  it('sends message via chatroom.send() on submit', async () => {
    renderPanel({ minds: [MIND_A] }, api);

    const textarea = screen.getByPlaceholderText('Message the chatroom…');
    fireEvent.change(textarea, { target: { value: 'hello all' } });
    await act(async () => {
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    });

    expect(api.chatroom.send).toHaveBeenCalledWith('hello all', undefined, expect.any(String));
  });

  // 7. Disabled when no agents
  it('shows disabled state when no agents loaded', () => {
    renderPanel({ minds: [] }, api);
    expect(screen.getByText(/no agents loaded/i)).toBeTruthy();
  });

  // 8. Streaming indicator
  it('shows streaming indicator for agents that are streaming', () => {
    const streamingMsg = makeChatroomMessage({
      id: 's1',
      role: 'assistant',
      blocks: [],
      isStreaming: true,
      sender: { mindId: 'mind-a', name: 'The Dude' },
    });
    renderPanel(
      {
        minds: [MIND_A],
        chatroomMessages: [streamingMsg],
        chatroomStreamingByMind: { 'mind-a': true },
      },
      api,
    );
    // The StreamingMessage component shows "Thinking…" for empty streaming messages
    expect(screen.getByText('Thinking…')).toBeTruthy();
  });

  // 9. Subscribes to chatroom events
  it('subscribes to chatroom events on mount', () => {
    renderPanel({ minds: [MIND_A] }, api);
    expect(api.chatroom.onEvent).toHaveBeenCalled();
  });

  // 10. OrchestrationPicker renders
  it('renders the orchestration picker', () => {
    renderPanel({ minds: [MIND_A] }, api);
    expect(screen.getByTestId('orchestration-picker')).toBeTruthy();
  });

  // 12. Stop button calls chatroom.stop()
  it('calls chatroom.stop() when stop is clicked during streaming', async () => {
    const streamingMsg = makeChatroomMessage({
      id: 's1',
      role: 'assistant',
      blocks: [{ type: 'text', content: 'partial' }],
      isStreaming: true,
      sender: { mindId: 'mind-a', name: 'The Dude' },
    });
    renderPanel(
      {
        minds: [MIND_A],
        chatroomMessages: [streamingMsg],
        chatroomStreamingByMind: { 'mind-a': true },
      },
      api,
    );

    // The stop button is the one inside ChatInput (not the orchestration buttons)
    const buttons = screen.getAllByRole('button');
    const stopButton = buttons.find(
      (b) => b.querySelector('svg rect') !== null,
    );
    expect(stopButton).toBeTruthy();
    await act(async () => {
      fireEvent.click(stopButton!);
    });
    expect(api.chatroom.stop).toHaveBeenCalled();
  });
});
