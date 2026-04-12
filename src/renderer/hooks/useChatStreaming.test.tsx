/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { act, waitFor } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { AppStateProvider } from '../lib/store';
import { installElectronAPI, mockElectronAPI } from '../../test/helpers';
import { useChatStreaming } from './useChatStreaming';

function wrapper({ children }: { children: React.ReactNode }) {
  return <AppStateProvider>{children}</AppStateProvider>;
}

describe('useChatStreaming', () => {
  let api: ReturnType<typeof mockElectronAPI>;

  beforeEach(() => {
    api = installElectronAPI();
  });

  it('sendMessage no-ops when no active mind', async () => {
    const { result } = renderHook(() => useChatStreaming(), { wrapper });

    await act(async () => {
      await result.current.sendMessage('Hello');
    });

    // No active mind → no-op
    expect(api.chat.send).not.toHaveBeenCalled();
  });

  it('sendMessage no-ops on empty string', async () => {
    const { result } = renderHook(() => useChatStreaming(), { wrapper });

    await act(async () => {
      await result.current.sendMessage('   ');
    });

    expect(api.chat.send).not.toHaveBeenCalled();
  });

  it('stopStreaming no-ops when no active mind', async () => {
    const { result } = renderHook(() => useChatStreaming(), { wrapper });

    await act(async () => {
      await result.current.stopStreaming();
    });

    expect(api.chat.stop).not.toHaveBeenCalled();
  });

  it('isStreaming reflects state', () => {
    const { result } = renderHook(() => useChatStreaming(), { wrapper });
    expect(result.current.isStreaming).toBe(false);
  });
});
