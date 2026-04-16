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
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      configurable: true,
      value: vi.fn(() => false),
    });
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
    api = installElectronAPI();
  });

  it('displays the current login', async () => {
    (api.auth.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ authenticated: true, login: 'ianphil_microsoft' });
    (api.auth.listAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([{ login: 'ianphil_microsoft' }]);
    render(<SettingsView />);
    await waitFor(() => {
      expect(screen.getByText('ianphil_microsoft')).toBeTruthy();
    });
  });

  it('shows "Not signed in" when no login is available', async () => {
    (api.auth.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ authenticated: false });
    (api.auth.listAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    render(<SettingsView />);
    await waitFor(() => {
      expect(screen.getByText('Not signed in')).toBeTruthy();
    });
  });

  it('calls auth.logout when Logout button is clicked', async () => {
    (api.auth.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ authenticated: true, login: 'ianphil_microsoft' });
    (api.auth.listAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([{ login: 'ianphil_microsoft' }]);
    render(<SettingsView />);
    await waitFor(() => {
      expect(screen.getByText('ianphil_microsoft')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /log out/i }));
    expect(api.auth.logout).toHaveBeenCalled();
  });

  it('renders a Settings heading', async () => {
    (api.auth.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ authenticated: true, login: 'alice' });
    (api.auth.listAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([{ login: 'alice' }]);
    render(<SettingsView />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /settings/i })).toBeTruthy();
    });
  });

  it('renders an Account section heading', async () => {
    (api.auth.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ authenticated: true, login: 'alice' });
    (api.auth.listAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([{ login: 'alice' }]);
    render(<SettingsView />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /account/i })).toBeTruthy();
    });
  });

  it('shows error fallback when getStatus rejects', async () => {
    (api.auth.getStatus as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('IPC failed'));
    (api.auth.listAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    render(<SettingsView />);
    await waitFor(() => {
      expect(screen.getByText('Unable to load account info')).toBeTruthy();
    });
  });

  it('renders a dropdown when multiple accounts exist', async () => {
    (api.auth.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ authenticated: true, login: 'alice' });
    (api.auth.listAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([{ login: 'alice' }, { login: 'bob' }]);

    render(<SettingsView />);

    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeTruthy();
    });
  });

  it('shows accounts sorted alphabetically with Add Account at the bottom', async () => {
    (api.auth.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ authenticated: true, login: 'alice' });
    (api.auth.listAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([{ login: 'zebra' }, { login: 'alice' }]);

    render(<SettingsView />);

    const trigger = await screen.findByRole('combobox');
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });

    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['alice', 'zebra', '+ Add Account']);
  });

  it('preselects the active account', async () => {
    (api.auth.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ authenticated: true, login: 'bob' });
    (api.auth.listAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([{ login: 'alice' }, { login: 'bob' }]);

    render(<SettingsView />);

    await waitFor(() => {
      expect(screen.getByRole('combobox').textContent).toContain('bob');
    });
  });

  it('switches accounts when a different account is selected', async () => {
    (api.auth.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ authenticated: true, login: 'alice' });
    (api.auth.listAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([{ login: 'alice' }, { login: 'bob' }]);

    render(<SettingsView />);

    const trigger = await screen.findByRole('combobox');
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: 'bob' }));

    await waitFor(() => {
      expect(api.auth.switchAccount).toHaveBeenCalledWith('bob');
    });
  });

  it('starts device flow when Add Account is clicked', async () => {
    (api.auth.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ authenticated: true, login: 'alice' });
    (api.auth.listAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([{ login: 'alice' }]);

    render(<SettingsView />);

    const trigger = await screen.findByRole('combobox');
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: '+ Add Account' }));

    await waitFor(() => {
      expect(api.auth.startLogin).toHaveBeenCalled();
    });
  });

  it('refreshes account state after auth:accountSwitched', async () => {
    let onAccountSwitched: (() => void) | undefined;
    (api.auth.getStatus as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ authenticated: true, login: 'alice' })
      .mockResolvedValueOnce({ authenticated: true, login: 'bob' });
    (api.auth.listAccounts as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ login: 'alice' }, { login: 'bob' }])
      .mockResolvedValueOnce([{ login: 'alice' }, { login: 'bob' }]);
    (api.auth.onAccountSwitched as ReturnType<typeof vi.fn>).mockImplementation((callback: () => void) => {
      onAccountSwitched = callback;
      return vi.fn();
    });

    render(<SettingsView />);

    await screen.findByText('alice');
    onAccountSwitched!();

    await waitFor(() => {
      expect(screen.getByRole('combobox').textContent).toContain('bob');
    });
  });

  it('shows a dropdown even when only one account exists', async () => {
    (api.auth.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ authenticated: true, login: 'alice' });
    (api.auth.listAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([{ login: 'alice' }]);

    render(<SettingsView />);

    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeTruthy();
    });
  });
});
