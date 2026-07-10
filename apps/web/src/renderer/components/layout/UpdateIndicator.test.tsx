/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { DesktopUpdateState } from '@chamber/shared/types';
import { installElectronAPI, mockElectronAPI } from '../../../test/helpers';
import { TooltipProvider } from '../ui/tooltip';
import { UpdateIndicator } from './UpdateIndicator';

type StateCallback = (state: DesktopUpdateState) => void;

function renderIndicator() {
  return render(
    <TooltipProvider>
      <UpdateIndicator />
    </TooltipProvider>,
  );
}

function makeState(overrides: Partial<DesktopUpdateState> = {}): DesktopUpdateState {
  return {
    enabled: true,
    status: 'up-to-date',
    currentVersion: '0.64.1',
    downloadPercent: null,
    message: null,
    canRetry: false,
    ...overrides,
  };
}

describe('UpdateIndicator', () => {
  let api: ReturnType<typeof mockElectronAPI>;
  let stateCallback: StateCallback | null;

  beforeEach(() => {
    api = installElectronAPI();
    stateCallback = null;
    (api.updater.onStateChanged as ReturnType<typeof vi.fn>).mockImplementation((cb: StateCallback) => {
      stateCallback = cb;
      return () => { stateCallback = null; };
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('renders nothing when updater is disabled', async () => {
    (api.updater.getState as ReturnType<typeof vi.fn>).mockResolvedValue(makeState({ enabled: false }));
    renderIndicator();
    await act(async () => {});
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows download percent under the icon while downloading', async () => {
    (api.updater.getState as ReturnType<typeof vi.fn>).mockResolvedValue(makeState({
      status: 'downloading',
      downloadPercent: 47,
    }));
    renderIndicator();
    const btn = await screen.findByRole('button');
    expect(btn.textContent).toContain('47%');
  });

  it('flashes "You\'re up to date" feedback after a user-initiated check resolves with up-to-date', async () => {
    (api.updater.getState as ReturnType<typeof vi.fn>).mockResolvedValue(makeState({ status: 'up-to-date' }));
    (api.updater.check as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });

    renderIndicator();
    const btn = await screen.findByRole('button', { name: 'Check for updates' });

    // Click triggers a user-initiated check; simulate the backend flipping to
    // 'checking' then back to 'up-to-date'. The indicator must surface a
    // transient confirmation so the click doesn't feel like a no-op.
    fireEvent.click(btn);
    expect(api.updater.check).toHaveBeenCalledOnce();

    await act(async () => {
      stateCallback?.(makeState({ status: 'checking' }));
    });
    await act(async () => {
      stateCallback?.(makeState({ status: 'up-to-date' }));
    });

    expect(screen.getByRole('button', { name: "You're up to date" })).toBeTruthy();
  });

  it('does not flash feedback when the state arrives without a user-initiated check', async () => {
    (api.updater.getState as ReturnType<typeof vi.fn>).mockResolvedValue(makeState({ status: 'up-to-date' }));
    renderIndicator();
    await screen.findByRole('button', { name: 'Check for updates' });

    // Background state-change event (e.g. periodic poll) should not flash feedback.
    await act(async () => {
      stateCallback?.(makeState({ status: 'up-to-date' }));
    });

    expect(screen.getByRole('button', { name: 'Check for updates' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: "You're up to date" })).toBeNull();
  });
});
