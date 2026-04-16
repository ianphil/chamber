/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GenesisGate } from './GenesisGate';
import { AppStateProvider } from '../../lib/store';
import { useAgentStatus } from '../../hooks/useAgentStatus';
import { installElectronAPI, mockElectronAPI } from '../../../test/helpers';

function TestWrapper({ children }: { children: React.ReactNode }) {
  useAgentStatus();
  return <>{children}</>;
}

function renderWithProvider(ui: React.ReactElement) {
  return render(<AppStateProvider><TestWrapper>{ui}</TestWrapper></AppStateProvider>);
}

describe('GenesisGate', () => {
  let api: ReturnType<typeof mockElectronAPI>;

  beforeEach(() => {
    api = installElectronAPI();
  });

  it('shows LandingScreen when no minds exist after check', async () => {
    renderWithProvider(<GenesisGate><div>App</div></GenesisGate>);

    // Wait for async mind.list() to resolve and MINDS_CHECKED to dispatch
    await waitFor(() => {
      expect(screen.getByText('New Agent', { exact: false })).toBeTruthy();
    });
    expect(screen.getByText('Open Existing', { exact: false })).toBeTruthy();
    expect(screen.queryByText('App')).toBeNull();
  });

  it('clicking Open Existing triggers file dialog via mind.selectDirectory', async () => {
    (api.mind.selectDirectory as ReturnType<typeof vi.fn>).mockResolvedValue('C:\\test\\mind');
    (api.mind.add as ReturnType<typeof vi.fn>).mockResolvedValue({
      mindId: 'test-1234', mindPath: 'C:\\test\\mind',
      identity: { name: 'Test', systemMessage: '' }, status: 'ready',
    });
    // After dialog, mind.list returns the newly added mind
    let callCount = 0;
    (api.mind.list as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callCount++;
      if (callCount <= 1) return []; // Initial check: empty
      return [{ mindId: 'test-1234', mindPath: 'C:\\test\\mind', identity: { name: 'Test', systemMessage: '' }, status: 'ready' }];
    });

    renderWithProvider(<GenesisGate><div>App</div></GenesisGate>);

    await waitFor(() => {
      expect(screen.getByText('Open Existing', { exact: false })).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Open Existing', { exact: false }));

    await waitFor(() => {
      expect(api.mind.selectDirectory).toHaveBeenCalled();
    });
  });

  it('shows Chamber loading screen during account switching instead of landing screen', async () => {
    render(
      <AppStateProvider testInitialState={{
        minds: [],
        mindsChecked: true,
        runtimePhase: 'switching-account',
        switchingAccountLogin: 'bob',
      }}
      >
        <GenesisGate><div>App</div></GenesisGate>
      </AppStateProvider>,
    );

    expect(screen.getByText('switching account and waking agents...', { exact: false })).toBeTruthy();
    expect(screen.queryByText('New Agent', { exact: false })).toBeNull();
    expect(screen.queryByText('App')).toBeNull();
  });

  it('shows a close button and returns to the app when landing was opened from chat', () => {
    render(
      <AppStateProvider testInitialState={{
        minds: [{ mindId: 'mind-1', mindPath: 'C:\\test\\mind', identity: { name: 'Test', systemMessage: '' }, status: 'ready' }],
        activeMindId: 'mind-1',
        mindsChecked: true,
        showLanding: true,
      }}
      >
        <GenesisGate><div>App</div></GenesisGate>
      </AppStateProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /close/i }));

    expect(screen.getByText('App')).toBeTruthy();
    expect(screen.queryByText('New Agent', { exact: false })).toBeNull();
  });

  it('does not show a close button on first-run empty state', async () => {
    renderWithProvider(<GenesisGate><div>App</div></GenesisGate>);

    await waitFor(() => {
      expect(screen.getByText('New Agent', { exact: false })).toBeTruthy();
    });

    expect(screen.queryByRole('button', { name: /close/i })).toBeNull();
  });
});
