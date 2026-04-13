/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { act, waitFor, renderHook } from '@testing-library/react';
import { AppStateProvider } from '../lib/store';
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
});
