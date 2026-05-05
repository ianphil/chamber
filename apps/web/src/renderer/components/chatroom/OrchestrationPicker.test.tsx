/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { OrchestrationPicker } from './OrchestrationPicker';
import type { MindContext } from '@chamber/shared/types';
import type { OrchestrationMode, GroupChatConfig, HandoffConfig, MagenticConfig } from '@chamber/shared/chatroom-types';

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
  handoffConfig?: HandoffConfig | null;
  magneticConfig?: MagenticConfig | null;
  minds?: MindContext[];
  disabled?: boolean;
  onModeChange?: (mode: OrchestrationMode) => void;
  onGroupChatConfigChange?: (config: GroupChatConfig) => void;
  onHandoffConfigChange?: (config: HandoffConfig) => void;
  onMagneticConfigChange?: (config: MagenticConfig) => void;
}) {
  const props = {
    mode: overrides?.mode ?? 'concurrent',
    groupChatConfig: overrides?.groupChatConfig ?? null,
    handoffConfig: overrides?.handoffConfig ?? null,
    magneticConfig: overrides?.magneticConfig ?? null,
    minds: overrides?.minds ?? [MIND_A, MIND_B],
    disabled: overrides?.disabled ?? false,
    onModeChange: overrides?.onModeChange ?? vi.fn(),
    onGroupChatConfigChange: overrides?.onGroupChatConfigChange ?? vi.fn(),
    onHandoffConfigChange: overrides?.onHandoffConfigChange ?? vi.fn(),
    onMagneticConfigChange: overrides?.onMagneticConfigChange ?? vi.fn(),
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

  it('Handoff and Magentic buttons are enabled and clickable', () => {
    const onModeChange = vi.fn();
    renderPicker({ onModeChange });
    const handoff = screen.getByText('Handoff');
    const magentic = screen.getByText('Magentic');
    expect(handoff.closest('button')?.disabled).toBe(false);
    expect(magentic.closest('button')?.disabled).toBe(false);

    fireEvent.click(handoff);
    expect(onModeChange).toHaveBeenCalledWith('handoff');
    fireEvent.click(magentic);
    expect(onModeChange).toHaveBeenCalledWith('magentic');
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

  // -------------------------------------------------------------------------
  // Handoff config
  // -------------------------------------------------------------------------

  it('shows initial agent selector when handoff mode is selected', () => {
    renderPicker({ mode: 'handoff' });
    expect(screen.getByText('Start with:')).toBeTruthy();
  });

  it('auto-creates default handoff config when switching to handoff', () => {
    const onModeChange = vi.fn();
    const onHandoffConfigChange = vi.fn();
    renderPicker({ onModeChange, onHandoffConfigChange });

    fireEvent.click(screen.getByText('Handoff'));
    expect(onModeChange).toHaveBeenCalledWith('handoff');
    expect(onHandoffConfigChange).toHaveBeenCalledWith(
      expect.objectContaining({
        initialMindId: 'mind-a',
        maxHandoffHops: 5,
      }),
    );
  });

  it('calls onHandoffConfigChange when initial agent is changed', () => {
    const onHandoffConfigChange = vi.fn();
    renderPicker({
      mode: 'handoff',
      handoffConfig: { initialMindId: 'mind-a', maxHandoffHops: 5 },
      onHandoffConfigChange,
    });

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'mind-b' } });
    expect(onHandoffConfigChange).toHaveBeenCalledWith(
      expect.objectContaining({ initialMindId: 'mind-b' }),
    );
  });

  // -------------------------------------------------------------------------
  // Magentic config
  // -------------------------------------------------------------------------

  it('shows manager selector when magentic mode is selected', () => {
    renderPicker({ mode: 'magentic' });
    expect(screen.getByText('Manager:')).toBeTruthy();
  });

  it('auto-creates default magentic config when switching to magentic', () => {
    const onModeChange = vi.fn();
    const onMagneticConfigChange = vi.fn();
    renderPicker({ onModeChange, onMagneticConfigChange });

    fireEvent.click(screen.getByText('Magentic'));
    expect(onModeChange).toHaveBeenCalledWith('magentic');
    expect(onMagneticConfigChange).toHaveBeenCalledWith(
      expect.objectContaining({
        managerMindId: 'mind-a',
        maxSteps: 10,
      }),
    );
  });

  it('calls onMagneticConfigChange when manager is changed', () => {
    const onMagneticConfigChange = vi.fn();
    renderPicker({
      mode: 'magentic',
      magneticConfig: { managerMindId: 'mind-a', maxSteps: 10 },
      onMagneticConfigChange,
    });

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'mind-b' } });
    expect(onMagneticConfigChange).toHaveBeenCalledWith(
      expect.objectContaining({ managerMindId: 'mind-b' }),
    );
  });

  // -------------------------------------------------------------------------
  // "Best for" guidance — caption + tooltip
  // -------------------------------------------------------------------------

  it('renders an inline description for the active mode', () => {
    renderPicker({ mode: 'concurrent' });
    // Caption begins with "Concurrent:" and includes the "Best for:" hint.
    expect(screen.getByText(/Concurrent:/)).toBeTruthy();
    expect(screen.getByText(/Best for:/)).toBeTruthy();
  });

  it('updates the inline description when the mode changes', () => {
    const { rerender } = renderPicker({ mode: 'concurrent' });
    expect(screen.queryByText(/Sequential:/)).toBeNull();

    rerender(
      <OrchestrationPicker
        mode="sequential"
        groupChatConfig={null}
        handoffConfig={null}
        magneticConfig={null}
        minds={[MIND_A, MIND_B]}
        disabled={false}
        onModeChange={vi.fn()}
        onGroupChatConfigChange={vi.fn()}
        onHandoffConfigChange={vi.fn()}
        onMagneticConfigChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/Sequential:/)).toBeTruthy();
  });

  it('exposes "Best for:" in each mode button title for hover tooltips', () => {
    renderPicker();
    for (const label of ['Concurrent', 'Sequential', 'Group Chat', 'Handoff', 'Magentic']) {
      const btn = screen.getByText(label).closest('button');
      expect(btn?.getAttribute('title')).toMatch(/Best for:/);
    }
  });
});
