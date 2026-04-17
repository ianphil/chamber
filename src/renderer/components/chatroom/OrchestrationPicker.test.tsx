/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { OrchestrationPicker } from './OrchestrationPicker';
import type { MindContext } from '../../../shared/types';
import type { OrchestrationMode, GroupChatConfig } from '../../../shared/chatroom-types';

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

function renderPicker(overrides?: {
  mode?: OrchestrationMode;
  groupChatConfig?: GroupChatConfig | null;
  minds?: MindContext[];
  disabled?: boolean;
  onModeChange?: (mode: OrchestrationMode) => void;
  onGroupChatConfigChange?: (config: GroupChatConfig) => void;
}) {
  const props = {
    mode: overrides?.mode ?? 'concurrent',
    groupChatConfig: overrides?.groupChatConfig ?? null,
    minds: overrides?.minds ?? [MIND_A, MIND_B],
    disabled: overrides?.disabled ?? false,
    onModeChange: overrides?.onModeChange ?? vi.fn(),
    onGroupChatConfigChange: overrides?.onGroupChatConfigChange ?? vi.fn(),
  };
  return render(<OrchestrationPicker {...props} />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OrchestrationPicker', () => {
  it('renders all mode buttons', () => {
    renderPicker();
    expect(screen.getByText('Concurrent')).toBeTruthy();
    expect(screen.getByText('Sequential')).toBeTruthy();
    expect(screen.getByText('Group Chat')).toBeTruthy();
    expect(screen.getByText('Handoff')).toBeTruthy();
    expect(screen.getByText('Magentic')).toBeTruthy();
  });

  it('disables Handoff and Magentic buttons', () => {
    renderPicker();
    const handoff = screen.getByText('Handoff');
    const magentic = screen.getByText('Magentic');
    expect(handoff.closest('button')?.disabled).toBe(true);
    expect(magentic.closest('button')?.disabled).toBe(true);
  });

  it('calls onModeChange when a mode is selected', () => {
    const onModeChange = vi.fn();
    renderPicker({ onModeChange });

    fireEvent.click(screen.getByText('Sequential'));
    expect(onModeChange).toHaveBeenCalledWith('sequential');
  });

  it('does not call onModeChange when disabled', () => {
    const onModeChange = vi.fn();
    renderPicker({ onModeChange, disabled: true });

    fireEvent.click(screen.getByText('Sequential'));
    expect(onModeChange).not.toHaveBeenCalled();
  });

  it('shows moderator selector when group-chat mode is selected', () => {
    renderPicker({ mode: 'group-chat' });
    expect(screen.getByText('Moderator:')).toBeTruthy();
  });

  it('does not show moderator selector for non-group-chat modes', () => {
    renderPicker({ mode: 'concurrent' });
    expect(screen.queryByText('Moderator:')).toBeNull();
  });

  it('auto-creates default group chat config when switching to group-chat', () => {
    const onModeChange = vi.fn();
    const onGroupChatConfigChange = vi.fn();
    renderPicker({ onModeChange, onGroupChatConfigChange });

    fireEvent.click(screen.getByText('Group Chat'));
    expect(onModeChange).toHaveBeenCalledWith('group-chat');
    expect(onGroupChatConfigChange).toHaveBeenCalledWith(
      expect.objectContaining({
        moderatorMindId: 'mind-a', // First ready mind
        maxTurns: 10,
        minRounds: 1,
        maxSpeakerRepeats: 3,
      }),
    );
  });

  it('moderator dropdown lists all ready minds', () => {
    renderPicker({
      mode: 'group-chat',
      groupChatConfig: {
        moderatorMindId: 'mind-a',
        maxTurns: 10,
        minRounds: 1,
        maxSpeakerRepeats: 3,
      },
    });
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(2);
    expect(options[0].textContent).toBe('The Dude');
    expect(options[1].textContent).toBe('Jarvis');
  });

  it('calls onGroupChatConfigChange when moderator is changed', () => {
    const onGroupChatConfigChange = vi.fn();
    renderPicker({
      mode: 'group-chat',
      groupChatConfig: {
        moderatorMindId: 'mind-a',
        maxTurns: 10,
        minRounds: 1,
        maxSpeakerRepeats: 3,
      },
      onGroupChatConfigChange,
    });

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'mind-b' } });
    expect(onGroupChatConfigChange).toHaveBeenCalledWith(
      expect.objectContaining({ moderatorMindId: 'mind-b' }),
    );
  });

  it('has data-testid orchestration-picker', () => {
    renderPicker();
    expect(screen.getByTestId('orchestration-picker')).toBeTruthy();
  });
});
