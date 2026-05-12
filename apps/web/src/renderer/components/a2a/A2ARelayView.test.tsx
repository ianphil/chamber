/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installElectronAPI, mockElectronAPI } from '../../../test/helpers';
import { A2ARelayView } from './A2ARelayView';

describe('A2ARelayView', () => {
  let api: ReturnType<typeof mockElectronAPI>;

  beforeEach(() => {
    api = installElectronAPI();
  });

  it('loads relay status from the main process', async () => {
    vi.mocked(api.a2a.relayStatus).mockResolvedValue({
      state: 'connected',
      mode: 'relay',
      relayBaseUrl: 'http://127.0.0.1:4317',
      publishedBaseUrl: null,
      publishedAgentCount: 3,
      relayAgentCount: 5,
      lastError: null,
      connectedAt: 1_700_000_000_000,
    });

    render(<A2ARelayView />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('http://127.0.0.1:4317')).toBeTruthy();
      expect(screen.getByText('Relay')).toBeTruthy();
      expect(screen.getByText('3')).toBeTruthy();
      expect(screen.getByText('5')).toBeTruthy();
    });
  });

  it('connects with the configured relay settings', async () => {
    render(<A2ARelayView />);

    await screen.findByRole('heading', { name: 'A2A Relay' });
    fireEvent.change(screen.getByLabelText('Relay bearer token'), { target: { value: 'relay-token' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(() => {
      expect(api.a2a.relayConnect).toHaveBeenCalledWith({
        relayBaseUrl: 'http://127.0.0.1:4317',
        relayToken: 'relay-token',
      });
    });
  });

  it('disconnects when connected', async () => {
    vi.mocked(api.a2a.relayStatus).mockResolvedValue({
      state: 'connected',
      mode: 'relay',
      relayBaseUrl: 'http://127.0.0.1:4317',
      publishedBaseUrl: null,
      publishedAgentCount: 1,
      relayAgentCount: 2,
      lastError: null,
      connectedAt: 1,
    });

    render(<A2ARelayView />);

    await waitFor(() => {
      expect((screen.getByRole('button', { name: 'Disconnect' }) as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));

    await waitFor(() => {
      expect(api.a2a.relayDisconnect).toHaveBeenCalled();
    });
  });
});
