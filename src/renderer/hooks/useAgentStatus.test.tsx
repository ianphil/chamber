/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { act, waitFor, renderHook } from '@testing-library/react';
import { AppStateProvider, useAppState } from '../lib/store';
import { installElectronAPI, mockElectronAPI } from '../../test/helpers';
import { useAgentStatus } from './useAgentStatus';
import type { MindContext } from '../../../shared/types';

const fakeMind: MindContext = {
  mindId: 'test-1234',
  mindPath: 'C:\\test\\mind',
  identity: { name: 'Test', systemMessage: '' },
  status: 'ready',
};

function wrapper({ children }: { children: React.ReactNode }) {
  return <AppStateProvider>{children}</AppStateProvider>;
}

describe('useAgentStatus', () => {
  let api: ReturnType<typeof mockElectronAPI>;

  beforeEach(() => {
    api = installElectronAPI();
  });

  it('loads minds via mind.list() and dispatches SET_MINDS on mount', async () => {
    (api.mind.list as ReturnType<typeof vi.fn>).mockResolvedValue([fakeMind]);

    const { result } = renderHook(() => useAgentStatus(), { wrapper });

    await waitFor(() => {
      expect(api.mind.list).toHaveBeenCalled();
      expect(result.current.minds).toEqual([fakeMind]);
    });
  });

  it('subscribes to mind.onMindChanged', () => {
    renderHook(() => useAgentStatus(), { wrapper });
    expect(api.mind.onMindChanged).toHaveBeenCalled();
  });

  it('unsubscribes on unmount', () => {
    const unsub = vi.fn();
    (api.mind.onMindChanged as ReturnType<typeof vi.fn>).mockReturnValue(unsub);

    const { unmount } = renderHook(() => useAgentStatus(), { wrapper });
    unmount();
    expect(unsub).toHaveBeenCalled();
  });

  it('selectMindDirectory uses mind.selectDirectory + mind.add', async () => {
    (api.mind.selectDirectory as ReturnType<typeof vi.fn>).mockResolvedValue('C:\\test\\mind');
    (api.mind.add as ReturnType<typeof vi.fn>).mockResolvedValue(fakeMind);
    (api.mind.list as ReturnType<typeof vi.fn>).mockResolvedValue([fakeMind]);

    const { result } = renderHook(() => useAgentStatus(), { wrapper });

    let dirPath: string | null = null;
    await act(async () => {
      dirPath = await result.current.selectMindDirectory();
    });

    expect(api.mind.selectDirectory).toHaveBeenCalled();
    expect(api.mind.add).toHaveBeenCalledWith('C:\\test\\mind');
    expect(dirPath).toBe('C:\\test\\mind');
  });

  it('selectMindDirectory returns null when dialog is cancelled', async () => {
    (api.mind.selectDirectory as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const { result } = renderHook(() => useAgentStatus(), { wrapper });

    let dirPath: string | null = 'not-null';
    await act(async () => {
      dirPath = await result.current.selectMindDirectory();
    });

    expect(dirPath).toBeNull();
    expect(api.mind.add).not.toHaveBeenCalled();
  });

  it('does not reference any agent.* APIs', () => {
    renderHook(() => useAgentStatus(), { wrapper });
    // None of the deprecated agent APIs should be called
    expect(api.mind.list).toHaveBeenCalled(); // uses mind namespace instead
  });

  it('tracks account switching lifecycle in app state', async () => {
    let onAccountSwitchStarted: ((data: { login: string }) => void) | undefined;
    let onAccountSwitched: ((data: { login: string }) => void) | undefined;
    (api.auth.onAccountSwitchStarted as ReturnType<typeof vi.fn>).mockImplementation((callback: (data: { login: string }) => void) => {
      onAccountSwitchStarted = callback;
      return vi.fn();
    });
    (api.auth.onAccountSwitched as ReturnType<typeof vi.fn>).mockImplementation((callback: (data: { login: string }) => void) => {
      onAccountSwitched = callback;
      return vi.fn();
    });

    const { result } = renderHook(() => {
      useAgentStatus();
      return useAppState();
    }, { wrapper });

    await act(async () => {
      onAccountSwitchStarted?.({ login: 'bob' });
    });

    expect(result.current.runtimePhase).toBe('switching-account');
    expect(result.current.switchingAccountLogin).toBe('bob');

    await act(async () => {
      onAccountSwitched?.({ login: 'bob' });
    });

    expect(result.current.runtimePhase).toBe('ready');
    expect(result.current.switchingAccountLogin).toBeNull();
  });

  it('dispatches LOGGED_OUT on onLoggedOut — resets runtimePhase without conflating with switch', async () => {
    let onAccountSwitchStarted: ((data: { login: string }) => void) | undefined;
    let onLoggedOut: (() => void) | undefined;
    (api.auth.onAccountSwitchStarted as ReturnType<typeof vi.fn>).mockImplementation((callback: (data: { login: string }) => void) => {
      onAccountSwitchStarted = callback;
      return vi.fn();
    });
    (api.auth.onLoggedOut as ReturnType<typeof vi.fn>).mockImplementation((callback: () => void) => {
      onLoggedOut = callback;
      return vi.fn();
    });

    const { result } = renderHook(() => {
      useAgentStatus();
      return useAppState();
    }, { wrapper });

    // Enter switching state
    await act(async () => {
      onAccountSwitchStarted?.({ login: 'alice' });
    });
    expect(result.current.runtimePhase).toBe('switching-account');

    // Logout interrupts the switch
    await act(async () => {
      onLoggedOut?.();
    });
    expect(result.current.runtimePhase).toBe('ready');
    expect(result.current.switchingAccountLogin).toBeNull();
  });
});
