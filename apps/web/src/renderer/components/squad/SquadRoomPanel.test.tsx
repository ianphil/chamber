/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SquadRoomPanel } from './SquadRoomPanel';
import { installElectronAPI, mockElectronAPI } from '../../../test/helpers';
import type { SquadRoomSnapshot } from '@chamber/shared/squad-types';

describe('SquadRoomPanel', () => {
  it('renders the choose-repository empty state', () => {
    installElectronAPI();

    render(<SquadRoomPanel />);

    expect(screen.getByText(/Choose a repository to open a Squad Room/i)).toBeTruthy();
    expect(screen.getByLabelText('Repository path')).toBeTruthy();
  });

  it('loads a ready Squad room from a typed path', async () => {
    const api = mockElectronAPI();
    api.squad.getRoom = vi.fn().mockResolvedValue(readyRoom());
    installElectronAPI(api);
    render(<SquadRoomPanel />);

    fireEvent.change(screen.getByLabelText('Repository path'), { target: { value: 'C:\\src\\cmux' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Load' }));
    });

    expect(api.squad.getRoom).toHaveBeenCalledWith('C:\\src\\cmux');
    await waitFor(() => {
      expect(screen.getByText('cmux')).toBeTruthy();
      expect(screen.getByText('Squad')).toBeTruthy();
      expect(screen.getAllByText('Frontend').length).toBeGreaterThan(0);
      expect(screen.getByText('Use React')).toBeTruthy();
    });
  });

  it('loads a selected repository through the desktop picker', async () => {
    const api = mockElectronAPI();
    api.squad.selectRepository = vi.fn().mockResolvedValue(readyRoom());
    installElectronAPI(api);
    render(<SquadRoomPanel />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Choose repo/i }));
    });

    expect(api.squad.selectRepository).toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByText('cmux')).toBeTruthy();
    });
  });

  it('shows the missing Squad state', async () => {
    const api = mockElectronAPI();
    api.squad.getRoom = vi.fn().mockResolvedValue({
      ...readyRoom(),
      status: 'missing',
      coordinator: null,
      agents: [],
      routingRules: [],
      decisions: [],
    });
    installElectronAPI(api);
    render(<SquadRoomPanel />);

    fireEvent.change(screen.getByLabelText('Repository path'), { target: { value: 'C:\\src\\empty' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Load' }));
    });

    await waitFor(() => {
      expect(screen.getByText(/No Squad setup found/i)).toBeTruthy();
    });
  });

  it('shows service errors', async () => {
    const api = mockElectronAPI();
    api.squad.getRoom = vi.fn().mockResolvedValue({
      ...readyRoom(),
      status: 'error',
      lastError: 'Invalid .squad/config.json',
    });
    installElectronAPI(api);
    render(<SquadRoomPanel />);

    fireEvent.change(screen.getByLabelText('Repository path'), { target: { value: 'C:\\src\\bad' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Load' }));
    });

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Invalid .squad/config.json');
    });
  });

  it('sends a prompt to a selected Squad agent', async () => {
    const api = mockElectronAPI();
    api.squad.getRoom = vi.fn().mockResolvedValue(readyRoom());
    api.squad.history = vi.fn().mockResolvedValue([]);
    api.squad.send = vi.fn().mockResolvedValue({
      success: true,
      turnId: 'turn-1',
      message: {
        id: 'message-1',
        roomId: 'C:\\src\\cmux',
        turnId: 'turn-1',
        role: 'assistant',
        sender: { kind: 'squad-agent', id: 'Trinity', name: 'Trinity' },
        content: 'I can help.',
        timestamp: 1,
      },
    });
    api.squad.history = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'user-1',
          roomId: 'C:\\src\\cmux',
          turnId: null,
          role: 'user',
          sender: { kind: 'user', id: 'user', name: 'User' },
          content: 'Can you help?',
          timestamp: 1,
        },
        {
          id: 'message-1',
          roomId: 'C:\\src\\cmux',
          turnId: 'turn-1',
          role: 'assistant',
          sender: { kind: 'squad-agent', id: 'Trinity', name: 'Trinity' },
          content: 'I can help.',
          timestamp: 2,
        },
      ]);
    installElectronAPI(api);
    render(<SquadRoomPanel />);

    fireEvent.change(screen.getByLabelText('Repository path'), { target: { value: 'C:\\src\\cmux' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Load' }));
    });
    fireEvent.change(screen.getByLabelText('Target Squad agent'), { target: { value: 'Trinity' } });
    fireEvent.change(screen.getByLabelText('Squad prompt'), { target: { value: 'Can you help?' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });

    expect(api.squad.send).toHaveBeenCalledWith({
      roomId: 'C:\\src\\cmux',
      repoPath: 'C:\\src\\cmux',
      prompt: 'Can you help?',
      targetAgentName: 'Trinity',
    });
    await waitFor(() => {
      expect(screen.getByText('I can help.')).toBeTruthy();
    });
  });

  it('applies streaming Squad events', async () => {
    let onEvent: Parameters<typeof window.electronAPI.squad.onEvent>[0] | null = null;
    const api = mockElectronAPI();
    api.squad.getRoom = vi.fn().mockResolvedValue(readyRoom());
    api.squad.history = vi.fn().mockResolvedValue([]);
    api.squad.onEvent = vi.fn().mockImplementation((callback) => {
      onEvent = callback;
      return vi.fn();
    });
    installElectronAPI(api);
    render(<SquadRoomPanel />);

    fireEvent.change(screen.getByLabelText('Repository path'), { target: { value: 'C:\\src\\cmux' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Load' }));
    });
    await act(async () => {
      onEvent?.({
        type: 'message-start',
        message: {
          id: 'message-1',
          roomId: 'C:\\src\\cmux',
          turnId: 'turn-1',
          role: 'assistant',
          sender: { kind: 'squad-coordinator', id: 'coordinator', name: 'Squad Coordinator' },
          content: '',
          timestamp: 1,
          isStreaming: true,
        },
      });
      onEvent?.({
        type: 'message-delta',
        roomId: 'C:\\src\\cmux',
        turnId: 'turn-1',
        messageId: 'message-1',
        delta: 'hello',
      });
    });

    expect(screen.getByText('hello')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Stop' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

function readyRoom(): SquadRoomSnapshot {
  return {
    id: 'C:\\src\\cmux',
    repoPath: 'C:\\src\\cmux',
    repoName: 'cmux',
    squadPath: 'C:\\src\\cmux\\.squad',
    status: 'ready',
    version: 1,
    coordinator: { name: 'Squad', role: 'Coordinator', charterPath: null, status: 'Routes work' },
    agents: [{ name: 'Trinity', role: 'Frontend', charterPath: 'agents/trinity/charter.md', status: 'ready' }],
    routingRules: [{ workType: 'Frontend', routeTo: 'Trinity', examples: 'React UI' }],
    decisions: [{ title: 'Use React', body: 'Keep the renderer native.' }],
    directives: null,
    sessions: ['session-1.json'],
    lastError: null,
  };
}
