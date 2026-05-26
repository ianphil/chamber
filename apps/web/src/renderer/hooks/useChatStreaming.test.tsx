/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { AppStateProvider, useAppDispatch } from '../lib/store';
import type { AppState } from '../lib/store/state';
import { installElectronAPI, mockElectronAPI } from '../../test/helpers';
import { useChatStreaming } from './useChatStreaming';

function wrapper(testInitialState?: Partial<AppState>) {
  return function TestWrapper({ children }: { children: React.ReactNode }) {
    return <AppStateProvider testInitialState={testInitialState}>{children}</AppStateProvider>;
  };
}

describe('useChatStreaming', () => {
  let api: ReturnType<typeof mockElectronAPI>;

  beforeEach(() => {
    api = installElectronAPI();
  });

  it('sendMessage no-ops when no active mind', async () => {
    const { result } = renderHook(() => useChatStreaming(), { wrapper: wrapper() });

    await act(async () => {
      await result.current.sendMessage('Hello');
    });

    // No active mind → no-op
    expect(api.chat.send).not.toHaveBeenCalled();
  });

  it('sendMessage no-ops on empty string', async () => {
    const { result } = renderHook(() => useChatStreaming(), { wrapper: wrapper() });

    await act(async () => {
      await result.current.sendMessage('   ');
    });

    expect(api.chat.send).not.toHaveBeenCalled();
  });

  it('stopStreaming no-ops when no active mind', async () => {
    const { result } = renderHook(() => useChatStreaming(), { wrapper: wrapper() });

    await act(async () => {
      await result.current.stopStreaming();
    });

    expect(api.chat.stop).not.toHaveBeenCalled();
  });

  it('isStreaming reflects state', () => {
    const { result } = renderHook(() => useChatStreaming(), { wrapper: wrapper() });
    expect(result.current.isStreaming).toBe(false);
  });

  it('stops the original streaming mind after switching away and back', async () => {
    const firstMind = {
      mindId: 'monica-1234',
      mindPath: 'C:\\agents\\monica',
      identity: { name: 'Monica', systemMessage: '' },
      status: 'ready' as const,
    };
    const secondMind = {
      mindId: 'q-1234',
      mindPath: 'C:\\agents\\q',
      identity: { name: 'Q', systemMessage: '' },
      status: 'ready' as const,
    };
    const { result } = renderHook(() => ({
      chat: useChatStreaming(),
      dispatch: useAppDispatch(),
    }), {
      wrapper: wrapper({ minds: [firstMind, secondMind], activeMindId: firstMind.mindId }),
    });

    await act(async () => {
      await result.current.chat.sendMessage('Hello');
    });
    const messageId = (api.chat.send as ReturnType<typeof vi.fn>).mock.calls[0][2] as string;

    act(() => {
      result.current.dispatch({ type: 'SET_ACTIVE_MIND', payload: secondMind.mindId });
    });
    act(() => {
      result.current.dispatch({ type: 'SET_ACTIVE_MIND', payload: firstMind.mindId });
    });
    await act(async () => {
      await result.current.chat.stopStreaming();
    });

    expect(api.chat.stop).toHaveBeenCalledWith(firstMind.mindId, messageId);
  });
});
