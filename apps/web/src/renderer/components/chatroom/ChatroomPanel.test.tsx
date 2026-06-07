/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { ChatroomPanel } from './ChatroomPanel';
import { AppStateProvider } from '../../lib/store';
import type { AppState } from '../../lib/store';
import type { MindContext } from '@chamber/shared/types';
import type { ElectronAPI } from '@chamber/shared/electron-types';
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
  // ChatroomPanel now requires an active chatroom session to render the
  // transcript surface. Default tests in this file exercise that path, so
  // seed an active session unless the caller explicitly opts out by passing
  // activeChatroomSessionId: null.
  const optOut = stateOverrides.activeChatroomSessionId === null;
  const seeded: Partial<AppState> = optOut
    ? stateOverrides
    : {
        activeChatroomSessionId: 'cr-test',
        chatroomSessions: [
          { sessionId: 'cr-test', title: 'Test chatroom', createdAt: '', updatedAt: '', active: true, hasMessages: false },
        ],
        ...stateOverrides,
      };
  // Keep the on-mount listSessions() refresh in sync with the seeded
  // state so it doesn't clobber the override (the reducer clears the
  // active id when the active session is no longer in the list).
  if (!optOut && seeded.chatroomSessions && Array.isArray(seeded.chatroomSessions)) {
    (mock.chatroom.listSessions as Mock).mockResolvedValue(seeded.chatroomSessions);
  }
  return {
    mock,
    ...render(
      <AppStateProvider testInitialState={seeded}>
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
    expect(screen.getByText(/work with several agents at once/i)).toBeTruthy();
  });

  // 2. Participant bar
  it('renders participant bar with loaded minds', () => {
    renderPanel({ minds: [MIND_A, MIND_B] }, api);
    // Names appear in both the participant bar and the orchestration diagram.
    expect(screen.getAllByText('The Dude').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Jarvis').length).toBeGreaterThanOrEqual(1);
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

  it('renders the saved user profile avatar for chatroom user messages', async () => {
    (api.userProfile.get as Mock).mockResolvedValue({
      displayName: 'Ian Philpot',
      work: 'Principal SWE Manager',
      location: 'Atlanta',
      about: '',
      avatarDataUrl: 'data:image/png;base64,aWFu',
      source: 'microsoft',
      microsoftAccount: 'ianphil@microsoft.com',
      updatedAt: '2026-05-09T00:00:00.000Z',
    });
    const userMsg = makeChatroomMessage({
      id: 'u-avatar',
      role: 'user',
      blocks: [{ type: 'text', content: 'hello with avatar' }],
      sender: { mindId: 'user', name: 'You' },
    });
    (api.chatroom.history as Mock).mockResolvedValue([userMsg]);

    renderPanel({ minds: [MIND_A], chatroomMessages: [userMsg] }, api);

    await waitFor(() => {
      expect(screen.getByAltText('You avatar')).toHaveProperty('src', 'data:image/png;base64,aWFu');
    });
    expect(screen.getByText('hello with avatar')).toBeTruthy();
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

  it('copies a completed agent message to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const agentMsg = makeChatroomMessage({
      id: 'copy-1',
      role: 'assistant',
      blocks: [{ type: 'text', content: 'copy me please' }],
      isStreaming: false,
      sender: { mindId: 'mind-a', name: 'The Dude' },
    });
    renderPanel({ minds: [MIND_A], chatroomMessages: [agentMsg] }, api);

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Copy message'));
    });

    expect(writeText).toHaveBeenCalledWith('copy me please');
  });

  it('renders agent profile avatars in participant and message rows', async () => {
    (api.mindProfile.get as Mock).mockResolvedValue({
      mindId: MIND_A.mindId,
      mindPath: MIND_A.mindPath,
      displayName: 'Dude Profile',
      folderName: 'dude',
      avatarDataUrl: 'data:image/png;base64,ZHVkZQ==',
      accentColor: null,
      soul: { kind: 'soul', label: 'SOUL.md', relativePath: 'SOUL.md', content: '', exists: true, mtimeMs: 1 },
      agentFiles: [],
      needsRestart: false,
    });
    const agentMsg = makeChatroomMessage({
      id: 'avatar-1',
      role: 'assistant',
      blocks: [{ type: 'text', content: 'profiled hello' }],
      sender: { mindId: MIND_A.mindId, name: MIND_A.identity.name },
    });
    (api.chatroom.history as Mock).mockResolvedValue([agentMsg]);

    renderPanel({ minds: [MIND_A], chatroomMessages: [agentMsg] }, api);

    await waitFor(() => {
      // Avatar appears in the participant bar, the orchestration diagram, and
      // the message row.
      expect(screen.getAllByAltText('Dude Profile avatar')).toHaveLength(3);
    });
    expect(screen.getAllByText('Dude Profile').length).toBeGreaterThanOrEqual(1);
  });

  // 5. Loads sessions on mount + auto-resumes the backend-active session
  it('loads sessions on mount and auto-resumes the backend-active session', async () => {
    const sessions = [
      { sessionId: 'cr-active', title: 'Active', createdAt: '', updatedAt: '', active: true, hasMessages: true },
    ];
    // Set BEFORE renderPanel so its post-install helper-override (which keys
    // off seeded.chatroomSessions) doesn't stomp these mocks.
    (api.chatroom.listSessions as Mock).mockResolvedValue(sessions);
    (api.chatroom.resumeSession as Mock).mockResolvedValue({
      session: sessions[0],
      messages: [],
      taskLedger: [],
    });

    await act(async () => {
      // activeChatroomSessionId: null opts out of the helper's session-seeding
      // so the explicit mocks above drive the mount auto-resume path.
      renderPanel({ minds: [MIND_A], activeChatroomSessionId: null }, api);
    });

    await waitFor(() => {
      expect(api.chatroom.listSessions).toHaveBeenCalled();
      expect(api.chatroom.resumeSession).toHaveBeenCalledWith('cr-active');
    });
  });

  // 5b. Hydrating skeleton while the mount auto-resume is in flight
  it('shows a hydrating skeleton while resuming instead of flashing the picker', async () => {
    // listSessions never settles, so the panel stays in its resuming state
    // and the skeleton must hold the surface.
    (api.chatroom.listSessions as Mock).mockReturnValue(new Promise<never>(() => {}));
    renderPanel({ minds: [MIND_A], activeChatroomSessionId: null }, api);
    // The skeleton is grace-gated, so it appears just after a short delay.
    expect(await screen.findByTestId('chatroom-hydrating-skeleton')).toBeTruthy();
    // The session picker's starter prompts must not pop in underneath.
    expect(screen.queryByText(/work with several agents at once/i)).toBeNull();
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

  // 11. Clicking a starter card targets that scenario's orchestration mode
  it('switches orchestration mode when a starter card is clicked', () => {
    const { mock } = renderPanel({ minds: [MIND_A], chatroomOrchestration: 'concurrent' }, api);
    fireEvent.click(screen.getByText('Outline, draft, polish'));
    expect(mock.chatroom.setOrchestration).toHaveBeenCalledWith('sequential', undefined);
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

  // 13. Participant toggle — disabled style + click invokes IPC
  describe('participant toggle', () => {
    it('renders agents as buttons with aria-pressed reflecting enabled state', () => {
      renderPanel({ minds: [MIND_A, MIND_B], chatroomDisabledMindIds: ['mind-b'] }, api);

      const dude = screen.getByRole('button', { name: /The Dude/ });
      const jarvis = screen.getByRole('button', { name: /Jarvis/ });
      expect(dude.getAttribute('aria-pressed')).toBe('true');
      expect(jarvis.getAttribute('aria-pressed')).toBe('false');
      // Disabled pill carries the line-through class.
      expect(jarvis.className).toContain('line-through');
      expect(dude.className).not.toContain('line-through');
    });

    it('clicking an enabled agent calls setMindEnabled(mindId, false)', async () => {
      renderPanel({ minds: [MIND_A], chatroomDisabledMindIds: [] }, api);
      const dude = screen.getByRole('button', { name: /The Dude/ });
      await act(async () => { fireEvent.click(dude); });
      expect(api.chatroom.setMindEnabled).toHaveBeenCalledWith('mind-a', false);
    });

    it('clicking a disabled agent calls setMindEnabled(mindId, true)', async () => {
      renderPanel({ minds: [MIND_A], chatroomDisabledMindIds: ['mind-a'] }, api);
      const dude = screen.getByRole('button', { name: /The Dude/ });
      await act(async () => { fireEvent.click(dude); });
      expect(api.chatroom.setMindEnabled).toHaveBeenCalledWith('mind-a', true);
    });

    it('hydrates chatroomDisabledMindIds from IPC on mount', async () => {
      (api.chatroom.getDisabledMindIds as Mock).mockResolvedValueOnce(['mind-b']);
      renderPanel({ minds: [MIND_A, MIND_B] }, api);
      await act(async () => { await Promise.resolve(); });
      expect(api.chatroom.getDisabledMindIds).toHaveBeenCalled();
    });
  });
});
