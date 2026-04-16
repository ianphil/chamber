/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthGate } from './AuthGate';
import { installElectronAPI, mockElectronAPI } from '../../../test/helpers';

describe('AuthGate', () => {
  let api: ReturnType<typeof mockElectronAPI>;

  beforeEach(() => {
    api = installElectronAPI();
  });

  it('renders children when authenticated', async () => {
    (api.auth.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ authenticated: true });
    render(<AuthGate><div>Protected Content</div></AuthGate>);
    await waitFor(() => {
      expect(screen.getByText('Protected Content')).toBeTruthy();
    });
  });

  it('does not render children when not authenticated', async () => {
    (api.auth.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ authenticated: false });
    render(<AuthGate><div>Protected Content</div></AuthGate>);
    await waitFor(() => {
      expect(screen.queryByText('Protected Content')).toBeNull();
    });
  });

  it('shows loading state initially', () => {
    (api.auth.getStatus as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => { /* noop */ })); // never resolves
    render(<AuthGate><div>Protected Content</div></AuthGate>);
    expect(screen.queryByText('Protected Content')).toBeNull();
  });

  it('reverts to auth screen when auth:loggedOut fires', async () => {
    let loggedOutCallback: (() => void) | undefined;
    (api.auth.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ authenticated: true });
    (api.auth.onLoggedOut as ReturnType<typeof vi.fn>).mockImplementation((cb: () => void) => {
      loggedOutCallback = cb;
      return vi.fn();
    });

    render(<AuthGate><div>Protected Content</div></AuthGate>);
    await waitFor(() => {
      expect(screen.getByText('Protected Content')).toBeTruthy();
    });

    // Simulate the loggedOut event — AuthGate sets authenticated=false directly
    loggedOutCallback!();

    await waitFor(() => {
      expect(screen.queryByText('Protected Content')).toBeNull();
    });
  });

  it('stays authenticated when auth:accountSwitched fires', async () => {
    let accountSwitchedCallback: ((data: { login: string }) => void) | undefined;
    (api.auth.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ authenticated: true, login: 'alice' });
    (api.auth.onAccountSwitched as ReturnType<typeof vi.fn>).mockImplementation((cb: (data: { login: string }) => void) => {
      accountSwitchedCallback = cb;
      return vi.fn();
    });

    render(<AuthGate><div>Protected Content</div></AuthGate>);
    await waitFor(() => {
      expect(screen.getByText('Protected Content')).toBeTruthy();
    });

    accountSwitchedCallback!({ login: 'bob' });

    await waitFor(() => {
      expect(screen.getByText('Protected Content')).toBeTruthy();
    });
  });

  it('cleans up onLoggedOut listener on unmount', async () => {
    const unsub = vi.fn();
    const unsubAccountSwitched = vi.fn();
    (api.auth.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ authenticated: true });
    (api.auth.onLoggedOut as ReturnType<typeof vi.fn>).mockReturnValue(unsub);
    (api.auth.onAccountSwitched as ReturnType<typeof vi.fn>).mockReturnValue(unsubAccountSwitched);

    const { unmount } = render(<AuthGate><div>Protected Content</div></AuthGate>);
    await waitFor(() => {
      expect(screen.getByText('Protected Content')).toBeTruthy();
    });

    unmount();
    expect(unsub).toHaveBeenCalled();
    expect(unsubAccountSwitched).toHaveBeenCalled();
  });
});
