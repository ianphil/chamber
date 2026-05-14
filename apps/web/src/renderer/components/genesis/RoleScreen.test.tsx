/**
 * @vitest-environment jsdom
 *
 * v0.60.0 Phase 2: the dream-daemon Switch lives at the bottom of RoleScreen
 * because Role is the LAST input the user makes before `genesis.create` fires.
 * Capturing the Switch state here means GenesisFlow can forward it into the
 * IPC payload without an extra screen + extra reload of state.
 *
 * Contract:
 *   - Switch defaults to OFF (strict opt-in).
 *   - `onSelect` signature is `(role: string, enableDreamDaemon: boolean)`.
 *   - The Switch is purely a captured field — toggling it does NOT submit.
 *     Clicking a role card (or pressing "That's my purpose" in the custom
 *     branch) is what fires `onSelect` with the captured Switch state.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

// Mock TypeWriter to fire onComplete immediately — the real implementation
// uses a 35ms-per-char setInterval that takes ~1.5s to finish, which would
// blow past Vitest's default `findBy*` 1000ms wait. The cards/Switch render
// after onComplete + a 500ms delay; bypassing the typewriter is the standard
// pattern in this codebase (see GenesisFlow.test.tsx — same approach).
vi.mock('./TypeWriter', () => ({
  TypeWriter: ({ text, onComplete }: { text: string; onComplete?: () => void }) => {
    React.useEffect(() => {
      onComplete?.();
    }, [onComplete]);
    return <span>{text}</span>;
  },
}));

import { RoleScreen } from './RoleScreen';

afterEach(() => {
  cleanup();
});

describe('RoleScreen — dream-daemon opt-in switch', () => {
  it('renders the dream-daemon Switch in the OFF position by default', async () => {
    render(<RoleScreen name="Test" onSelect={vi.fn()} />);
    const toggle = await screen.findByRole('switch', { name: /dream daemon/i });
    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('toggling the Switch updates aria-checked to true', async () => {
    render(<RoleScreen name="Test" onSelect={vi.fn()} />);
    const toggle = await screen.findByRole('switch', { name: /dream daemon/i });
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(toggle.getAttribute('aria-checked')).toBe('true');
    });
  });

  it('opt-out (default): clicking a role card calls onSelect with enableDreamDaemon=false', async () => {
    const onSelect = vi.fn();
    render(<RoleScreen name="Test" onSelect={onSelect} />);
    const card = await screen.findByRole('button', { name: /Chief of Staff/i });
    fireEvent.click(card);
    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledTimes(1);
    });
    expect(onSelect).toHaveBeenCalledWith('Chief of Staff', false);
  });

  it('opt-in: toggling the Switch ON, then clicking a card, calls onSelect with enableDreamDaemon=true', async () => {
    const onSelect = vi.fn();
    render(<RoleScreen name="Test" onSelect={onSelect} />);
    const toggle = await screen.findByRole('switch', { name: /dream daemon/i });
    fireEvent.click(toggle);
    const card = await screen.findByRole('button', { name: /Engineering Partner/i });
    fireEvent.click(card);
    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledTimes(1);
    });
    expect(onSelect).toHaveBeenCalledWith('Engineering Partner', true);
  });

  it('custom-role branch: opt-in propagates through "That\'s my purpose"', async () => {
    const onSelect = vi.fn();
    render(<RoleScreen name="Test" onSelect={onSelect} />);
    const toggle = await screen.findByRole('switch', { name: /dream daemon/i });
    fireEvent.click(toggle);

    const customCard = await screen.findByRole('button', { name: /Something else/i });
    fireEvent.click(customCard);

    const input = await screen.findByPlaceholderText(/Creative Director/i);
    fireEvent.change(input, { target: { value: 'Debate Coach' } });
    const submit = await screen.findByRole('button', { name: /That's my purpose/i });
    fireEvent.click(submit);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('Debate Coach', true);
  });
});
