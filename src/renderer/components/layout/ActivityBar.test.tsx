/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { ActivityBar } from './ActivityBar';
import { AppStateProvider } from '../../lib/store';
import { TooltipProvider } from '../ui/tooltip';
import { installElectronAPI } from '../../../test/helpers';

function renderActivityBar() {
  return render(
    <AppStateProvider>
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
});
