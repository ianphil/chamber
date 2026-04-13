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
});
