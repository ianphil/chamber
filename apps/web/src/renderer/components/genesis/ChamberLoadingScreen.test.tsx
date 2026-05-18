/** @vitest-environment jsdom */
import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { version } from '../../../../../../package.json';
import type { StartupProgressEvent } from '@chamber/shared/types';
import { ChamberLoadingScreen } from './ChamberLoadingScreen';
import { installElectronAPI, mockElectronAPI } from '../../../test/helpers';

describe('ChamberLoadingScreen', () => {
  let api: ReturnType<typeof mockElectronAPI>;
  let emitStartup: ((event: StartupProgressEvent) => void) | undefined;

  beforeEach(() => {
    api = mockElectronAPI();
    emitStartup = undefined;
    api.app.onStartupProgress = vi.fn((callback: (event: StartupProgressEvent) => void) => {
      emitStartup = callback;
      return () => {
        emitStartup = undefined;
      };
    });
    installElectronAPI(api);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the app version from package.json during startup', () => {
    vi.useFakeTimers();

    render(<ChamberLoadingScreen />);

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(screen.getByText(`> chamber v${version}`)).toBeTruthy();
  });

  it('shows the app version from package.json while switching accounts', () => {
    vi.useFakeTimers();

    render(<ChamberLoadingScreen mode="switching-account" login="alice" />);

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(screen.getByText(`> chamber v${version}`)).toBeTruthy();
  });

  describe('boot activity log (#56)', () => {
    it('subscribes to electronAPI.app.onStartupProgress on mount in startup mode', () => {
      render(<ChamberLoadingScreen />);
      expect(api.app.onStartupProgress).toHaveBeenCalledTimes(1);
    });

    it('appends a formatted line each time a startup progress event arrives', () => {
      render(<ChamberLoadingScreen />);

      act(() => {
        emitStartup?.({ kind: 'restore-start', detail: 'restoring minds from config' });
      });
      expect(screen.getByText(/restoring minds from config/)).toBeTruthy();

      act(() => {
        emitStartup?.({ kind: 'mind-restored', detail: 'Alfred' });
      });
      expect(screen.getByText(/Alfred ready/)).toBeTruthy();

      act(() => {
        emitStartup?.({ kind: 'restore-complete', detail: '2 minds ready' });
      });
      expect(screen.getByText(/2 minds ready/)).toBeTruthy();
    });

    it('does NOT subscribe in switching-account mode (different lifecycle)', () => {
      render(<ChamberLoadingScreen mode="switching-account" login="octocat" />);
      expect(api.app.onStartupProgress).not.toHaveBeenCalled();
    });

    it('unsubscribes on unmount so a later mount does not double-subscribe', () => {
      const unsubscribe = vi.fn();
      api.app.onStartupProgress = vi.fn((callback: (event: StartupProgressEvent) => void) => {
        emitStartup = callback;
        return unsubscribe;
      });
      installElectronAPI(api);

      const { unmount } = render(<ChamberLoadingScreen />);
      unmount();
      expect(unsubscribe).toHaveBeenCalled();
    });

    it('renders mind-failed events with a clear failure marker (no payload leak)', () => {
      render(<ChamberLoadingScreen />);
      act(() => {
        emitStartup?.({ kind: 'mind-failed', detail: 'broken-mind' });
      });
      expect(screen.getByText(/failed to restore broken-mind/)).toBeTruthy();
    });
  });
});
