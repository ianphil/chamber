/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PopoutAvatarWindow } from './PopoutAvatarWindow';
import { AppStateProvider } from '../../lib/store';
import { installElectronAPI } from '../../../test/helpers';
import type { ElectronAPI, MindContext } from '@chamber/shared/types';

vi.mock('./AgentAvatarPanel', () => ({
  AgentAvatarPanel: ({ agentName }: { agentName: string }) => (
    <div data-testid="agent-avatar-stage">{agentName}</div>
  ),
}));

const mind: MindContext = {
  mindId: 'alfred-1',
  mindPath: 'C:\\agents\\alfred',
  identity: { name: 'Alfred', systemMessage: '' },
  status: 'ready',
};

function renderPopout() {
  const electronAPI = installElectronAPI();

  return {
    electronAPI,
    ...render(
    <AppStateProvider
      testInitialState={{
        minds: [mind],
        activeMindId: mind.mindId,
        mindsChecked: true,
        messagesByMind: {
          [mind.mindId]: [
            {
              id: 'assistant-1',
              role: 'assistant',
              blocks: [{ type: 'text', content: 'Hello from Alfred.' }],
              timestamp: 1,
            },
          ],
        },
      }}
    >
      <PopoutAvatarWindow popoutMindId={mind.mindId} />
    </AppStateProvider>,
    ),
  };
}

describe('PopoutAvatarWindow', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('starts in avatar mode without starter prompt buttons', () => {
    renderPopout();

    expect(screen.getByTestId('agent-avatar-stage').textContent).toBe('Alfred');
    expect(screen.getByLabelText('Show transcript')).toBeTruthy();
    expect(screen.queryByText('Daily briefing')).toBeNull();
  });

  it('switches to transcript mode when the red exit button is clicked', () => {
    renderPopout();

    fireEvent.click(screen.getByLabelText('Show transcript'));

    expect(screen.queryByTestId('agent-avatar-stage')).toBeNull();
    expect(screen.getByText('Conversation transcript')).toBeTruthy();
    expect(screen.getByText('Hello from Alfred.')).toBeTruthy();
    expect(screen.queryByText('Daily briefing')).toBeNull();
  });

  it('keeps speech recognition errors visible when recognition ends immediately', async () => {
    installMicrophoneAccess();
    const { electronAPI } = renderPopout();
    vi.mocked((electronAPI as ElectronAPI).voice.recognizeOnce).mockResolvedValue({
      provider: 'windows-system-speech',
      text: '',
      error: 'No speech recognized. Try again after the listening indicator appears.',
    });

    fireEvent.click(screen.getByLabelText('Start voice input'));

    await waitFor(() => {
      expect(screen.getByText(/No speech recognized\. Try again/)).toBeTruthy();
    });
  });

  it('submits final speech recognition transcript to the active mind', async () => {
    installMicrophoneAccess();
    const { electronAPI } = renderPopout();
    vi.mocked((electronAPI as ElectronAPI).voice.recognizeOnce).mockResolvedValue({
      provider: 'windows-system-speech',
      text: 'what is on my calendar',
    });

    fireEvent.click(screen.getByLabelText('Start voice input'));

    await waitFor(() => {
      expect((electronAPI as ElectronAPI).chat.send).toHaveBeenCalledWith(
        mind.mindId,
        'what is on my calendar',
        expect.any(String),
        undefined,
        undefined,
      );
    });
  });
});

function installMicrophoneAccess() {
  Object.defineProperty(navigator, 'mediaDevices', {
    value: {
      getUserMedia: vi.fn().mockResolvedValue({
        getTracks: () => [{ stop: vi.fn() }],
      }),
    },
    configurable: true,
  });
}
