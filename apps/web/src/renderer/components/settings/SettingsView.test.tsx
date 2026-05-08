/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { version } from '../../../../../../package.json';
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

  it('shows the app version from package.json', async () => {
    (api.auth.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ authenticated: true, login: 'alice' });
    (api.auth.listAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([{ login: 'alice' }]);
    render(<SettingsView />);
    await waitFor(() => {
      expect(screen.getByText(`Chamber v${version}`)).toBeTruthy();
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

    // Add Account opens the modal which subscribes BEFORE calling startLogin —
    // assert via the modal's dialog role and the eventual startLogin invocation.
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /add a github account/i })).toBeTruthy();
    });
    await waitFor(() => {
      expect(api.auth.startLogin).toHaveBeenCalled();
    });
    expect(api.auth.onProgress).toHaveBeenCalled();
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

  it('refreshes account state after a freshly added login broadcasts auth:accountSwitched', async () => {
    let onAccountSwitched: (() => void) | undefined;
    (api.auth.getStatus as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ authenticated: true, login: 'alice' })
      .mockResolvedValueOnce({ authenticated: true, login: 'newuser' });
    (api.auth.listAccounts as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ login: 'alice' }])
      .mockResolvedValueOnce([{ login: 'alice' }, { login: 'newuser' }]);
    (api.auth.onAccountSwitched as ReturnType<typeof vi.fn>).mockImplementation((callback: () => void) => {
      onAccountSwitched = callback;
      return vi.fn();
    });

    render(<SettingsView />);

    await screen.findByText('alice');
    // Simulate the IPC broadcast that fires after AuthService stores credentials
    // for the new account — the dropdown must reflect the new account without a restart.
    onAccountSwitched!();

    await waitFor(() => {
      expect(screen.getByRole('combobox').textContent).toContain('newuser');
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

  it('lists followed marketplaces', async () => {
    (api.marketplace.listGenesisRegistries as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'github:ianphil/genesis-minds',
        label: 'Public Genesis Minds',
        url: 'https://github.com/ianphil/genesis-minds',
        owner: 'ianphil',
        repo: 'genesis-minds',
        ref: 'master',
        plugin: 'genesis-minds',
        enabled: true,
        isDefault: true,
      },
    ]);

    render(<SettingsView />);

    expect(await screen.findByText('Public Genesis Minds')).toBeTruthy();
    expect(screen.getByText('https://github.com/ianphil/genesis-minds')).toBeTruthy();
  });

  it('adds a marketplace from settings and refreshes the list', async () => {
    (api.marketplace.listGenesisRegistries as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'github:agency-microsoft/genesis-minds',
          label: 'agency-microsoft/genesis-minds',
          url: 'https://github.com/agency-microsoft/genesis-minds',
          owner: 'agency-microsoft',
          repo: 'genesis-minds',
          ref: 'main',
          plugin: 'genesis-minds',
          enabled: true,
          isDefault: false,
        },
      ]);

    render(<SettingsView />);

    fireEvent.change(await screen.findByLabelText('Marketplace repository URL'), {
      target: { value: 'https://github.com/agency-microsoft/genesis-minds' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(api.marketplace.addGenesisRegistry).toHaveBeenCalledWith('https://github.com/agency-microsoft/genesis-minds');
    });
    expect(await screen.findByText('agency-microsoft/genesis-minds')).toBeTruthy();
  });

  it('disables, refreshes, and removes marketplaces from settings', async () => {
    const agencyMarketplace = {
      id: 'github:agency-microsoft/genesis-minds',
      label: 'agency-microsoft/genesis-minds',
      url: 'https://github.com/agency-microsoft/genesis-minds',
      owner: 'agency-microsoft',
      repo: 'genesis-minds',
      ref: 'main',
      plugin: 'genesis-minds',
      enabled: true,
      isDefault: false,
    };
    (api.marketplace.listGenesisRegistries as ReturnType<typeof vi.fn>).mockResolvedValue([agencyMarketplace]);

    render(<SettingsView />);

    await screen.findByText('agency-microsoft/genesis-minds');
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => {
      expect(api.marketplace.setGenesisRegistryEnabled).toHaveBeenCalledWith('github:agency-microsoft/genesis-minds', false);
      expect(api.marketplace.refreshGenesisRegistry).toHaveBeenCalledWith('github:agency-microsoft/genesis-minds');
      expect(api.marketplace.removeGenesisRegistry).toHaveBeenCalledWith('github:agency-microsoft/genesis-minds');
    });
  });
});
