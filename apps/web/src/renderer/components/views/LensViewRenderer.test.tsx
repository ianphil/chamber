/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ElectronAPI } from '@chamber/shared/types';
import { mockElectronAPI, makeLensViewManifest } from '../../../test/helpers';
import { LensViewRenderer } from './LensViewRenderer';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function installElectronAPI(api: ElectronAPI): void {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: api,
  });
}

describe('LensViewRenderer', () => {
  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, 'electronAPI');
    vi.restoreAllMocks();
  });

  it('applies an in-flight refresh result after the view remounts', async () => {
    const api = mockElectronAPI();
    vi.mocked(api.lens.getViewData).mockResolvedValue({ status: 'stale' });
    const refresh = deferred<Record<string, unknown> | null>();
    vi.mocked(api.lens.refreshView).mockReturnValue(refresh.promise);
    installElectronAPI(api);

    const view = makeLensViewManifest({
      id: 'daily-briefing',
      name: 'Daily Briefing',
      prompt: 'Refresh this briefing',
      view: 'briefing',
    });

    const { unmount } = render(<LensViewRenderer view={view} />);
    expect(await screen.findByText('stale')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    unmount();

    render(<LensViewRenderer view={view} />);
    expect(await screen.findByText('stale')).toBeTruthy();

    refresh.resolve({ status: 'fresh' });

    await waitFor(() => {
      expect(screen.getByText('fresh')).toBeTruthy();
    });
  });
});
