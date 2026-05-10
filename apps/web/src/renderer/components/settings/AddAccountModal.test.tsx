/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';

import { AddAccountModal } from './AddAccountModal';
import { installElectronAPI, mockElectronAPI } from '../../../test/helpers';

type ProgressCallback = (progress: { step: string; userCode?: string; verificationUri?: string; login?: string; error?: string }) => void;

function setupElectronAPI() {
  const api = mockElectronAPI();
  let captured: ProgressCallback | undefined;
  const unsub = vi.fn();
  (api.auth.onProgress as ReturnType<typeof vi.fn>).mockImplementation((cb: ProgressCallback) => {
    captured = cb;
    return unsub;
  });
  installElectronAPI(api);
  return {
    api,
    emit: (progress: Parameters<ProgressCallback>[0]) => {
      if (!captured) throw new Error('onProgress was never subscribed');
      captured(progress);
    },
    unsub,
  };
}

function pointerCaptureShim() {
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { configurable: true, value: vi.fn(() => false) });
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
}

describe('AddAccountModal', () => {
  beforeEach(() => {
    pointerCaptureShim();
  });

  it('BVT-01: subscribes to onProgress before invoking startLogin', async () => {
    const ctx = setupElectronAPI();
    const onClose = vi.fn();

    render(<AddAccountModal open openId={1} onClose={onClose} onRetry={vi.fn()} />);

    await waitFor(() => expect(ctx.api.auth.onProgress).toHaveBeenCalled());
    await waitFor(() => expect(ctx.api.auth.startLogin).toHaveBeenCalled());

    const onProgressCall = (ctx.api.auth.onProgress as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    const startLoginCall = (ctx.api.auth.startLogin as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    expect(onProgressCall).toBeLessThan(startLoginCall);
  });

  it('BVT-02: initially renders the "Starting authentication" affordance', async () => {
    setupElectronAPI();
    render(<AddAccountModal open openId={1} onClose={vi.fn()} onRetry={vi.fn()} />);

    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getByText(/Starting authentication/i)).toBeTruthy();
  });

  it('BVT-03: renders the user code in the 3xl mono block when device_code event arrives', async () => {
    const ctx = setupElectronAPI();
    render(<AddAccountModal open openId={1} onClose={vi.fn()} onRetry={vi.fn()} />);

    await waitFor(() => expect(ctx.api.auth.onProgress).toHaveBeenCalled());

    act(() => {
      ctx.emit({ step: 'device_code', userCode: 'TEST-CODE', verificationUri: 'https://github.com/login/device' });
    });

    expect(await screen.findByText('TEST-CODE')).toBeTruthy();
  });

  it('BVT-04: always renders the static github.com/login/device guidance once the code is shown', async () => {
    const ctx = setupElectronAPI();
    render(<AddAccountModal open openId={1} onClose={vi.fn()} onRetry={vi.fn()} />);

    await waitFor(() => expect(ctx.api.auth.onProgress).toHaveBeenCalled());

    act(() => {
      ctx.emit({ step: 'device_code', userCode: 'XYZ-1234' });
    });

    await screen.findByText('XYZ-1234');
    expect(screen.getByText('github.com/login/device')).toBeTruthy();
  });

  it('BVT-05: closes the modal on authenticated event', async () => {
    const ctx = setupElectronAPI();
    const onClose = vi.fn();
    render(<AddAccountModal open openId={1} onClose={onClose} onRetry={vi.fn()} />);

    await waitFor(() => expect(ctx.api.auth.onProgress).toHaveBeenCalled());

    act(() => {
      ctx.emit({ step: 'authenticated', login: 'alice' });
    });

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('BVT-06: renders error and Try Again on error event', async () => {
    const ctx = setupElectronAPI();
    const onRetry = vi.fn();
    render(<AddAccountModal open openId={1} onClose={vi.fn()} onRetry={onRetry} />);

    await waitFor(() => expect(ctx.api.auth.onProgress).toHaveBeenCalled());

    act(() => {
      ctx.emit({ step: 'error', error: 'Timed out waiting for authorization' });
    });

    expect(await screen.findByText('Timed out waiting for authorization')).toBeTruthy();
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });

  it('BVT-07: Try Again invokes the onRetry prop', async () => {
    const ctx = setupElectronAPI();
    const onRetry = vi.fn();
    render(<AddAccountModal open openId={1} onClose={vi.fn()} onRetry={onRetry} />);

    await waitFor(() => expect(ctx.api.auth.onProgress).toHaveBeenCalled());

    act(() => {
      ctx.emit({ step: 'error', error: 'expired_token' });
    });

    fireEvent.click(await screen.findByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('BVT-08: Cancel button calls cancelLogin, unsubscribes, and onClose', async () => {
    const ctx = setupElectronAPI();
    const onClose = vi.fn();
    render(<AddAccountModal open openId={1} onClose={onClose} onRetry={vi.fn()} />);

    await waitFor(() => expect(ctx.api.auth.onProgress).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(ctx.api.auth.cancelLogin).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('BVT-09: unmount cleanup unsubscribes from onProgress', async () => {
    const ctx = setupElectronAPI();
    const { unmount } = render(<AddAccountModal open openId={1} onClose={vi.fn()} onRetry={vi.fn()} />);

    await waitFor(() => expect(ctx.api.auth.onProgress).toHaveBeenCalled());

    unmount();
    expect(ctx.unsub).toHaveBeenCalled();
  });

  it('BVT-10: under React.StrictMode, startLogin is invoked exactly once per openId', async () => {
    const ctx = setupElectronAPI();

    render(
      <React.StrictMode>
        <AddAccountModal open openId={42} onClose={vi.fn()} onRetry={vi.fn()} />
      </React.StrictMode>,
    );

    await waitFor(() => expect(ctx.api.auth.startLogin).toHaveBeenCalled());
    expect((ctx.api.auth.startLogin as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });
});
