/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { SettingsView } from './SettingsView';
import { installElectronAPI, mockElectronAPI } from '../../../test/helpers';

describe('SettingsView', () => {
  let api: ReturnType<typeof mockElectronAPI>;

  beforeEach(() => {
    api = installElectronAPI();
  });

  it('displays the current login', async () => {
    (api.auth.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ authenticated: true, login: 'ianphil_microsoft' });
    render(<SettingsView />);
    await waitFor(() => {
      expect(screen.getByText('ianphil_microsoft')).toBeTruthy();
    });
  });

  it('shows "Not signed in" when no login is available', async () => {
    (api.auth.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ authenticated: false });
    render(<SettingsView />);
    await waitFor(() => {
      expect(screen.getByText('Not signed in')).toBeTruthy();
    });
  });

  it('calls auth.logout when Logout button is clicked', async () => {
    (api.auth.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ authenticated: true, login: 'ianphil_microsoft' });
    render(<SettingsView />);
    await waitFor(() => {
      expect(screen.getByText('ianphil_microsoft')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /log out/i }));
    expect(api.auth.logout).toHaveBeenCalled();
  });

  it('renders a Settings heading', async () => {
    (api.auth.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ authenticated: true, login: 'alice' });
    render(<SettingsView />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /settings/i })).toBeTruthy();
    });
  });

  it('renders an Account section heading', async () => {
    (api.auth.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ authenticated: true, login: 'alice' });
    render(<SettingsView />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /account/i })).toBeTruthy();
    });
  });

  it('shows error fallback when getStatus rejects', async () => {
    (api.auth.getStatus as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('IPC failed'));
    render(<SettingsView />);
    await waitFor(() => {
      expect(screen.getByText('Unable to load account info')).toBeTruthy();
    });
  });
});
