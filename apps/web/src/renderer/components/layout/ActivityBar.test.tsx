/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { ActivityBar } from './ActivityBar';
import { AppStateProvider } from '../../lib/store';
import type { AppState } from '../../lib/store/state';
import { TooltipProvider } from '../ui/tooltip';
import { installElectronAPI, mockElectronAPI } from '../../../test/helpers';

function renderActivityBar(testInitialState?: Partial<AppState>) {
  return render(
    <AppStateProvider testInitialState={testInitialState}>
      <TooltipProvider>
        <ActivityBar />
      </TooltipProvider>
    </AppStateProvider>,
  );
}

describe('ActivityBar', () => {
  beforeEach(() => {
    installElectronAPI();
  });

  it('renders a settings gear button', () => {
    renderActivityBar();
    expect(screen.getByLabelText('Settings')).toBeTruthy();
  });

  it('settings button is at the bottom of the bar', () => {
    renderActivityBar();
    const settingsButton = screen.getByLabelText('Settings');
    expect(settingsButton.closest('[data-testid="activity-bar-footer"]')).toBeTruthy();
  });

  it('renders chat and chatroom buttons', () => {
    renderActivityBar();
    expect(screen.getByLabelText('Chat')).toBeTruthy();
    expect(screen.getByLabelText('Chatroom')).toBeTruthy();
  });

  it('renders the updater action when an update is available', async () => {
    const api = mockElectronAPI();
    api.updater.getState = vi.fn().mockResolvedValue({
      enabled: true,
      status: 'available',
      currentVersion: '0.33.2',
      availableVersion: '0.33.3',
      downloadPercent: null,
      message: 'Update 0.33.3 is available.',
      canRetry: false,
    });
    installElectronAPI(api);

    renderActivityBar();

    await waitFor(() => {
      expect(screen.getByLabelText('Download Chamber 0.33.3')).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // Running indicator — yellow dot when any chatroom mind is streaming
  // -------------------------------------------------------------------------

  it('does not render the running indicator when no chatroom minds are streaming', () => {
    renderActivityBar({ chatroomStreamingByMind: {} });
    const chatroomBtn = screen.getByLabelText('Chatroom');
    // The pulse dot is the only span with .animate-pulse inside the chatroom button.
    expect(chatroomBtn.querySelector('.animate-pulse')).toBeNull();
  });

  it('renders the running indicator when at least one chatroom mind is streaming', () => {
    renderActivityBar({ chatroomStreamingByMind: { 'mind-1': true } });
    const chatroomBtn = screen.getByLabelText('Chatroom');
    expect(chatroomBtn.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('does not render the running indicator when all streams are flagged false', () => {
    renderActivityBar({ chatroomStreamingByMind: { 'mind-1': false, 'mind-2': false } });
    const chatroomBtn = screen.getByLabelText('Chatroom');
    expect(chatroomBtn.querySelector('.animate-pulse')).toBeNull();
  });
});
