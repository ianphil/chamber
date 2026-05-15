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
    fireEvent.change(screen.getByLabelText('Authentication mode'), { target: { value: 'static' } });
    fireEvent.change(screen.getByLabelText('Relay bearer token'), { target: { value: 'relay-token' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(() => {
      expect(api.a2a.relayConnect).toHaveBeenCalledWith({
        relayBaseUrl: 'http://127.0.0.1:4317',
        authMode: 'static',
        relayToken: 'relay-token',
      });
    });
  });

  it('connects with interactive Entra auth without requiring a relay token', async () => {
    render(<A2ARelayView />);

    await screen.findByRole('heading', { name: 'A2A Relay' });
    fireEvent.change(screen.getByLabelText('Relay base URL'), { target: { value: 'https://switchboard.example.com' } });
    fireEvent.change(screen.getByLabelText('Authentication mode'), { target: { value: 'interactive' } });

    expect(screen.queryByLabelText('Relay bearer token')).toBeNull();
    expect(screen.queryByLabelText('Entra client ID')).toBeNull();
    expect(screen.queryByLabelText('Tenant ID')).toBeNull();
    expect(screen.queryByLabelText('OAuth scope')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(() => {
      expect(api.a2a.relayConnect).toHaveBeenCalledWith({
        relayBaseUrl: 'https://switchboard.example.com',
        authMode: 'interactive',
      });
    });
  });

  it('requires a token only for static relay auth', async () => {
    render(<A2ARelayView />);

    await screen.findByRole('heading', { name: 'A2A Relay' });
    fireEvent.change(screen.getByLabelText('Authentication mode'), { target: { value: 'static' } });
    expect((screen.getByRole('button', { name: 'Connect' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Authentication mode'), { target: { value: 'interactive' } });
    expect((screen.getByRole('button', { name: 'Connect' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('can reconnect static auth with a saved relay token without exposing the token', async () => {
    vi.mocked(api.a2a.relayStatus).mockResolvedValue({
      state: 'disconnected',
      mode: 'local',
      relayBaseUrl: 'http://127.0.0.1:4317',
      hasStoredRelayToken: true,
      publishedBaseUrl: null,
      publishedAgentCount: 0,
      relayAgentCount: 0,
      lastError: null,
      connectedAt: null,
    });
    render(<A2ARelayView />);

    await screen.findByDisplayValue('http://127.0.0.1:4317');
    expect((screen.getByLabelText('Relay bearer token') as HTMLInputElement).value).toBe('');
    expect((screen.getByRole('button', { name: 'Connect' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(() => {
      expect(api.a2a.relayConnect).toHaveBeenCalledWith({
        relayBaseUrl: 'http://127.0.0.1:4317',
        authMode: 'static',
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
