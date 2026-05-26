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
import { AppStateProvider } from '../../lib/store';
import { DEFAULT_APP_FEATURE_FLAGS } from '@chamber/shared/feature-flags';
import type { AppFeatureFlags } from '@chamber/shared/feature-flags';

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

// Helper: wrap RoleScreen with an AppStateProvider whose feature-flag slice
// has `dreamDaemon` set explicitly. Defaults to ON so the Switch is rendered
// (which is what every test in this file was originally written against).
// Flag-off cases pass `{ dreamDaemon: false }` to confirm the Switch is
// hidden and `enableDreamDaemon` is coerced to false in onSelect payloads.
function renderRoleScreen(
  props: { name: string; onSelect: (role: string, enableDreamDaemon: boolean) => void },
  flags: Partial<AppFeatureFlags> = { dreamDaemon: true },
) {
  return render(
    <AppStateProvider testInitialState={{ featureFlags: { ...DEFAULT_APP_FEATURE_FLAGS, ...flags } }}>
      <RoleScreen {...props} />
    </AppStateProvider>,
  );
}

describe('RoleScreen — dream-daemon opt-in switch', () => {
  it('renders the dream-daemon Switch in the OFF position by default', async () => {
    renderRoleScreen({ name: 'Test', onSelect: vi.fn() });
    const toggle = await screen.findByRole('switch', { name: /dream daemon/i });
    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('toggling the Switch updates aria-checked to true', async () => {
    renderRoleScreen({ name: 'Test', onSelect: vi.fn() });
    const toggle = await screen.findByRole('switch', { name: /dream daemon/i });
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(toggle.getAttribute('aria-checked')).toBe('true');
    });
  });

  it('opt-out (default): clicking a role card calls onSelect with enableDreamDaemon=false', async () => {
    const onSelect = vi.fn();
    renderRoleScreen({ name: 'Test', onSelect });
    const card = await screen.findByRole('button', { name: /Chief of Staff/i });
    fireEvent.click(card);
    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledTimes(1);
    });
    expect(onSelect).toHaveBeenCalledWith('Chief of Staff', false);
  });

  it('opt-in: toggling the Switch ON, then clicking a card, calls onSelect with enableDreamDaemon=true', async () => {
    const onSelect = vi.fn();
    renderRoleScreen({ name: 'Test', onSelect });
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
    renderRoleScreen({ name: 'Test', onSelect });
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

describe('RoleScreen — feature-flag gate (dreamDaemon: false)', () => {
  // Mirrors the gating in IdentityLoader / MindProfileService / MindManager:
  // when the app-level `dreamDaemon` flag is off, the Switch is hidden and
  // the renderer coerces the value forwarded into `onSelect` to false so
  // a stale local state can never smuggle an opt-in past the boundary.
  it('hides the dream-daemon Switch when the feature flag is off', async () => {
    renderRoleScreen({ name: 'Test', onSelect: vi.fn() }, { dreamDaemon: false });
    // The role cards still render via the typewriter completion path.
    await screen.findByRole('button', { name: /Chief of Staff/i });
    // The Switch must NOT be in the DOM at all.
    expect(screen.queryByRole('switch', { name: /dream daemon/i })).toBeNull();
  });

  it('forces onSelect enableDreamDaemon=false when the feature flag is off', async () => {
    const onSelect = vi.fn();
    renderRoleScreen({ name: 'Test', onSelect }, { dreamDaemon: false });
    const card = await screen.findByRole('button', { name: /Research Partner/i });
    fireEvent.click(card);
    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledTimes(1);
    });
    expect(onSelect).toHaveBeenCalledWith('Research Partner', false);
  });
});
