/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LensViewManifest, MindContext } from '@chamber/shared/types';
import { installElectronAPI, mockElectronAPI } from '../../test/helpers';
import { AppStateProvider, useAppState } from '../lib/store';
import type { AppState } from '../lib/store/state';
import { useAppSubscriptions } from './useAppSubscriptions';

const activeMind: MindContext = {
  mindId: 'q-1234',
  mindPath: 'C:\\agents\\q',
  identity: { name: 'Q', systemMessage: '' },
  status: 'ready',
};

const otherMind: MindContext = {
  mindId: 'moneypenny-1234',
  mindPath: 'C:\\agents\\moneypenny',
  identity: { name: 'Moneypenny', systemMessage: '' },
  status: 'ready',
};

const activeView: LensViewManifest = {
  id: 'briefing',
  name: 'Briefing',
  icon: 'newspaper',
  view: 'briefing',
  source: 'briefing.json',
};

const otherView: LensViewManifest = {
  id: 'briefing',
  name: 'Other Briefing',
  icon: 'newspaper',
  view: 'briefing',
  source: 'briefing.json',
};

function wrapper(testInitialState: Partial<AppState>) {
  return function TestWrapper({ children }: { children: React.ReactNode }) {
    return <AppStateProvider testInitialState={testInitialState}>{children}</AppStateProvider>;
  };
}

describe('useAppSubscriptions', () => {
  let api: ReturnType<typeof mockElectronAPI>;
  let onViewsChanged: ((views: LensViewManifest[], mindId?: string) => void) | undefined;

  beforeEach(() => {
    api = installElectronAPI();
    onViewsChanged = undefined;
    (api.lens.onViewsChanged as ReturnType<typeof vi.fn>).mockImplementation((callback) => {
      onViewsChanged = callback;
      return vi.fn();
    });
  });

  it('loads Lens views for the active mind', async () => {
    (api.lens.getViews as ReturnType<typeof vi.fn>).mockResolvedValue([activeView]);

    const { result } = renderHook(() => {
      useAppSubscriptions();
      return useAppState();
    }, {
      wrapper: wrapper({ minds: [activeMind], activeMindId: activeMind.mindId }),
    });

    await waitFor(() => {
      expect(api.lens.getViews).toHaveBeenCalledWith(activeMind.mindId);
      expect(result.current.discoveredViews).toEqual([activeView]);
    });
  });

  it('ignores Lens hot-load events from inactive minds', async () => {
    (api.lens.getViews as ReturnType<typeof vi.fn>).mockResolvedValue([activeView]);

    const { result } = renderHook(() => {
      useAppSubscriptions();
      return useAppState();
    }, {
      wrapper: wrapper({ minds: [activeMind, otherMind], activeMindId: activeMind.mindId }),
    });

    await waitFor(() => {
      expect(result.current.discoveredViews).toEqual([activeView]);
    });

    onViewsChanged?.([otherView], otherMind.mindId);

    expect(result.current.discoveredViews).toEqual([activeView]);
  });

  it('accepts Lens hot-load events for the active mind', async () => {
    (api.lens.getViews as ReturnType<typeof vi.fn>).mockResolvedValue([otherView]);

    const { result } = renderHook(() => {
      useAppSubscriptions();
      return useAppState();
    }, {
      wrapper: wrapper({ minds: [activeMind], activeMindId: activeMind.mindId }),
    });

    await waitFor(() => {
      expect(result.current.discoveredViews).toEqual([otherView]);
    });

    act(() => {
      onViewsChanged?.([activeView], activeMind.mindId);
    });

    await waitFor(() => {
      expect(result.current.discoveredViews).toEqual([activeView]);
    });
  });
});
