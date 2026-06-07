/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { DesktopUpdateState } from '@chamber/shared/types';
import { installElectronAPI, mockElectronAPI } from '../../../test/helpers';
import { TooltipProvider } from '../ui/tooltip';
import { UpdateBanner } from './UpdateBanner';

const SESSION_KEY = 'chamber:update-banner-dismissed-version';

function renderBanner() {
  return render(
    <TooltipProvider>
      <UpdateBanner />
    </TooltipProvider>,
  );
}

function makeState(overrides: Partial<DesktopUpdateState> = {}): DesktopUpdateState {
  return {
    enabled: true,
    status: 'downloaded',
    currentVersion: '0.64.1',
    downloadedVersion: '0.65.0',
    downloadPercent: 100,
    message: null,
    canRetry: false,
    ...overrides,
  };
}

describe('UpdateBanner', () => {
  let api: ReturnType<typeof mockElectronAPI>;

  beforeEach(() => {
    sessionStorage.clear();
    api = installElectronAPI();
  });

  afterEach(() => {
    cleanup();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('renders nothing when updater is disabled', async () => {
    (api.updater.getState as ReturnType<typeof vi.fn>).mockResolvedValue(makeState({ enabled: false }));
    renderBanner();
    await act(async () => {});
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('renders nothing for non-downloaded states', async () => {
    (api.updater.getState as ReturnType<typeof vi.fn>).mockResolvedValue(makeState({ status: 'up-to-date' }));
    renderBanner();
    await act(async () => {});
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows a restart-now CTA naming the downloaded version', async () => {
    (api.updater.getState as ReturnType<typeof vi.fn>).mockResolvedValue(makeState());
    renderBanner();
    await act(async () => {});

    const banner = await screen.findByRole('status');
    expect(banner.textContent).toContain('Chamber 0.65.0 is ready to install');
    expect(screen.getByRole('button', { name: 'Restart now' })).toBeTruthy();
  });

  it('calls installAndRestart when the user clicks Restart now', async () => {
    (api.updater.getState as ReturnType<typeof vi.fn>).mockResolvedValue(makeState());
    renderBanner();
    await act(async () => {});

    fireEvent.click(screen.getByRole('button', { name: 'Restart now' }));
    expect(api.updater.installAndRestart).toHaveBeenCalledOnce();
  });

  it('dismissing hides the banner for that version only', async () => {
    (api.updater.getState as ReturnType<typeof vi.fn>).mockResolvedValue(makeState());
    renderBanner();
    await act(async () => {});

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss update reminder' }));
    expect(screen.queryByRole('status')).toBeNull();
    expect(sessionStorage.getItem(SESSION_KEY)).toBe('0.65.0');

    cleanup();

    // A newer downloaded version should re-surface the banner.
    (api.updater.getState as ReturnType<typeof vi.fn>).mockResolvedValue(makeState({ downloadedVersion: '0.65.1' }));
    renderBanner();
    await act(async () => {});
    expect(await screen.findByRole('status')).toBeTruthy();
  });
});
