/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LensViewManifest, MindContext } from '@chamber/shared/types';
import type { A2AInboundApprovalRequest } from '@chamber/shared/a2a-types';
import { installElectronAPI, makeChatEvent, makeMessage, mockElectronAPI } from '../../test/helpers';
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

function makeApproval(id = 'approval-1'): A2AInboundApprovalRequest {
  return {
    id,
    digest: `digest-${id}`,
    kind: 'message',
    targetMindId: activeMind.mindId,
    request: {
      recipient: activeMind.mindId,
      message: {
        messageId: `message-${id}`,
        role: 'ROLE_USER',
        parts: [{ text: 'Review this request.' }],
      },
    },
    sender: {
      identity: {
        authentication: 'entra',
        principalId: 'sender-principal',
        tenantId: 'sender-tenant',
      },
      agent: { name: 'External agent' },
    },
    recipient: {
      identity: {
        authentication: 'entra',
        principalId: 'recipient-principal',
        tenantId: 'recipient-tenant',
      },
      agent: { name: activeMind.identity.name, identifier: activeMind.mindId },
    },
    preview: 'Review this request.',
    state: 'pending',
    receivedAt: '2026-07-12T14:00:00.000Z',
    expiresAt: '2026-07-12T14:15:00.000Z',
  };
}

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

  it('replays missed chat events when the window regains focus', async () => {
    (api.chat.getEventSequence as ReturnType<typeof vi.fn>).mockResolvedValue(5);
    (api.chat.replayEvents as ReturnType<typeof vi.fn>).mockResolvedValue([{
      sequence: 6,
      mindId: activeMind.mindId,
      messageId: 'assistant-1',
      event: makeChatEvent('done'),
    }]);

    const { result } = renderHook(() => {
      useAppSubscriptions();
      return useAppState();
    }, {
      wrapper: wrapper({
        minds: [activeMind],
        activeMindId: activeMind.mindId,
        isStreaming: true,
        streamingByMind: { [activeMind.mindId]: true },
        messagesByMind: {
          [activeMind.mindId]: [makeMessage([], { id: 'assistant-1', isStreaming: true })],
        },
      }),
    });

    await waitFor(() => {
      expect(api.chat.getEventSequence).toHaveBeenCalled();
    });

    window.dispatchEvent(new Event('focus'));

    await waitFor(() => {
      expect(api.chat.replayEvents).toHaveBeenCalledWith(5);
      expect(result.current.streamingByMind[activeMind.mindId]).toBe(false);
      expect(result.current.isStreaming).toBe(false);
    });
  });

  it('replays lower missed chat events when a higher live event arrives first', async () => {
    (api.chat.getEventSequence as ReturnType<typeof vi.fn>).mockResolvedValue(5);
    let onChatEvent: Parameters<typeof api.chat.onEvent>[0] | undefined;
    let resolveReplay: (events: Awaited<ReturnType<typeof api.chat.replayEvents>>) => void = () => undefined;
    (api.chat.onEvent as ReturnType<typeof vi.fn>).mockImplementation((callback) => {
      onChatEvent = callback;
      return vi.fn();
    });
    (api.chat.replayEvents as ReturnType<typeof vi.fn>).mockReturnValue(new Promise((resolve) => {
      resolveReplay = resolve;
    }));

    const { result } = renderHook(() => {
      useAppSubscriptions();
      return useAppState();
    }, {
      wrapper: wrapper({
        minds: [activeMind],
        activeMindId: activeMind.mindId,
        isStreaming: true,
        streamingByMind: { [activeMind.mindId]: true },
        messagesByMind: {
          [activeMind.mindId]: [makeMessage([], { id: 'assistant-1', isStreaming: true })],
        },
      }),
    });

    await waitFor(() => {
      expect(api.chat.getEventSequence).toHaveBeenCalled();
      expect(onChatEvent).toBeDefined();
    });

    window.dispatchEvent(new Event('focus'));
    await waitFor(() => {
      expect(api.chat.replayEvents).toHaveBeenCalledWith(5);
    });

    act(() => {
      onChatEvent?.(activeMind.mindId, 'assistant-1', makeChatEvent('chunk', { content: 'late live chunk' }), 8);
    });

    await act(async () => {
      resolveReplay([{
        sequence: 6,
        mindId: activeMind.mindId,
        messageId: 'assistant-1',
        event: makeChatEvent('done'),
      }]);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.streamingByMind[activeMind.mindId]).toBe(false);
      expect(result.current.isStreaming).toBe(false);
    });
  });

  it('refreshes conversation history after a terminal chat event', async () => {
    let onChatEvent: Parameters<typeof api.chat.onEvent>[0] | undefined;
    (api.chat.onEvent as ReturnType<typeof vi.fn>).mockImplementation((callback) => {
      onChatEvent = callback;
      return vi.fn();
    });
    (api.conversationHistory.list as ReturnType<typeof vi.fn>).mockResolvedValue([{
      sessionId: 'session-1',
      title: 'Fresh title',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:01.000Z',
      kind: 'chat',
      active: true,
    }]);

    const { result } = renderHook(() => {
      useAppSubscriptions();
      return useAppState();
    }, {
      wrapper: wrapper({
        minds: [activeMind],
        activeMindId: activeMind.mindId,
        isStreaming: true,
        streamingByMind: { [activeMind.mindId]: true },
        messagesByMind: {
          [activeMind.mindId]: [makeMessage([], { id: 'assistant-1', isStreaming: true })],
        },
      }),
    });

    await waitFor(() => {
      expect(onChatEvent).toBeDefined();
    });

    act(() => {
      onChatEvent?.(activeMind.mindId, 'assistant-1', makeChatEvent('done'), 1);
    });

    await waitFor(() => {
      expect(api.conversationHistory.list).toHaveBeenCalledWith(activeMind.mindId);
      expect(result.current.conversationHistoryByMind[activeMind.mindId][0].title).toBe('Fresh title');
    });
  });

  it('hydrates and subscribes to pending inbound A2A approvals when relay mode is enabled', async () => {
    const hydratedApproval = makeApproval();
    const updatedApproval = makeApproval('approval-2');
    let onApprovalStateChanged: ((approvals: A2AInboundApprovalRequest[]) => void) | undefined;
    (api.app.getFeatureFlags as ReturnType<typeof vi.fn>).mockResolvedValue({
      switchboardRelay: true,
      byoLlm: false,
      chamberCopilot: false,
      voiceDictation: false,
      wtdTopology: false,
    });
    (api.a2a.listPendingApprovals as ReturnType<typeof vi.fn>).mockResolvedValue([hydratedApproval]);
    (api.a2a.onApprovalStateChanged as ReturnType<typeof vi.fn>).mockImplementation((callback) => {
      onApprovalStateChanged = callback;
      return vi.fn();
    });

    const { result } = renderHook(() => {
      useAppSubscriptions();
      return useAppState();
    }, {
      wrapper: wrapper({
        featureFlags: {
          switchboardRelay: true,
          byoLlm: false,
          chamberCopilot: false,
          voiceDictation: false,
          wtdTopology: false,
        },
      }),
    });

    await waitFor(() => {
      expect(api.a2a.listPendingApprovals).toHaveBeenCalled();
      expect(result.current.pendingA2AApprovals).toEqual([hydratedApproval]);
      expect(onApprovalStateChanged).toBeDefined();
    });

    act(() => {
      onApprovalStateChanged?.([updatedApproval]);
    });

    expect(result.current.pendingA2AApprovals).toEqual([updatedApproval]);
  });

  it('does not overwrite a newer approval subscription event with stale hydration', async () => {
    const staleApproval = makeApproval('stale-approval');
    const currentApproval = makeApproval('current-approval');
    let resolveHydration: (approvals: A2AInboundApprovalRequest[]) => void = () => undefined;
    let onApprovalStateChanged: ((approvals: A2AInboundApprovalRequest[]) => void) | undefined;
    (api.app.getFeatureFlags as ReturnType<typeof vi.fn>).mockResolvedValue({
      switchboardRelay: true,
      byoLlm: false,
      chamberCopilot: false,
      voiceDictation: false,
      wtdTopology: false,
    });
    (api.a2a.listPendingApprovals as ReturnType<typeof vi.fn>).mockReturnValue(new Promise((resolve) => {
      resolveHydration = resolve;
    }));
    (api.a2a.onApprovalStateChanged as ReturnType<typeof vi.fn>).mockImplementation((callback) => {
      onApprovalStateChanged = callback;
      return vi.fn();
    });

    const { result } = renderHook(() => {
      useAppSubscriptions();
      return useAppState();
    }, {
      wrapper: wrapper({
        featureFlags: {
          switchboardRelay: true,
          byoLlm: false,
          chamberCopilot: false,
          voiceDictation: false,
          wtdTopology: false,
        },
      }),
    });

    await waitFor(() => {
      expect(onApprovalStateChanged).toBeDefined();
    });
    act(() => {
      onApprovalStateChanged?.([currentApproval]);
    });
    await act(async () => {
      resolveHydration([staleApproval]);
      await Promise.resolve();
    });

    expect(result.current.pendingA2AApprovals).toEqual([currentApproval]);
  });

  it('selects a pending approval requested from a notification click', async () => {
    const approval = makeApproval();
    let onApprovalReviewRequested: ((id: string) => void) | undefined;
    (api.app.getFeatureFlags as ReturnType<typeof vi.fn>).mockResolvedValue({
      switchboardRelay: true,
      byoLlm: false,
      chamberCopilot: false,
      voiceDictation: false,
      wtdTopology: false,
    });
    (api.a2a.listPendingApprovals as ReturnType<typeof vi.fn>).mockResolvedValue([approval]);
    (api.a2a.onApprovalReviewRequested as ReturnType<typeof vi.fn>).mockImplementation((callback) => {
      onApprovalReviewRequested = callback;
      return vi.fn();
    });

    const { result } = renderHook(() => {
      useAppSubscriptions();
      return useAppState();
    }, {
      wrapper: wrapper({
        featureFlags: {
          switchboardRelay: true,
          byoLlm: false,
          chamberCopilot: false,
          voiceDictation: false,
          wtdTopology: false,
        },
      }),
    });

    await waitFor(() => {
      expect(result.current.pendingA2AApprovals).toEqual([approval]);
      expect(onApprovalReviewRequested).toBeDefined();
    });

    act(() => {
      onApprovalReviewRequested?.(approval.id);
    });

    expect(result.current.selectedA2AApprovalId).toBe(approval.id);
  });

  it('refreshes approvals when a notification requests an approval not yet hydrated', async () => {
    const approval = makeApproval();
    let onApprovalReviewRequested: ((id: string) => void) | undefined;
    (api.app.getFeatureFlags as ReturnType<typeof vi.fn>).mockResolvedValue({
      switchboardRelay: true,
      byoLlm: false,
      chamberCopilot: false,
      voiceDictation: false,
      wtdTopology: false,
    });
    (api.a2a.listPendingApprovals as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([approval]);
    (api.a2a.onApprovalReviewRequested as ReturnType<typeof vi.fn>).mockImplementation((callback) => {
      onApprovalReviewRequested = callback;
      return vi.fn();
    });

    const { result } = renderHook(() => {
      useAppSubscriptions();
      return useAppState();
    }, {
      wrapper: wrapper({
        featureFlags: {
          switchboardRelay: true,
          byoLlm: false,
          chamberCopilot: false,
          voiceDictation: false,
          wtdTopology: false,
        },
      }),
    });

    await waitFor(() => {
      expect(api.a2a.listPendingApprovals).toHaveBeenCalledTimes(1);
      expect(onApprovalReviewRequested).toBeDefined();
    });
    act(() => {
      onApprovalReviewRequested?.(approval.id);
    });

    await waitFor(() => {
      expect(api.a2a.listPendingApprovals).toHaveBeenCalledTimes(2);
      expect(result.current.pendingA2AApprovals).toEqual([approval]);
      expect(result.current.selectedA2AApprovalId).toBe(approval.id);
    });
  });

  it('clears pending inbound A2A approvals and does not subscribe when relay mode is disabled', async () => {
    const { result } = renderHook(() => {
      useAppSubscriptions();
      return useAppState();
    }, {
      wrapper: wrapper({
        featureFlags: {
          switchboardRelay: false,
          byoLlm: false,
          chamberCopilot: false,
          voiceDictation: false,
          wtdTopology: false,
        },
        pendingA2AApprovals: [makeApproval()],
        selectedA2AApprovalId: 'approval-1',
      }),
    });

    await waitFor(() => {
      expect(result.current.pendingA2AApprovals).toEqual([]);
      expect(result.current.selectedA2AApprovalId).toBeNull();
    });
    expect(api.a2a.listPendingApprovals).not.toHaveBeenCalled();
    expect(api.a2a.onApprovalStateChanged).not.toHaveBeenCalled();
    expect(api.a2a.onApprovalReviewRequested).not.toHaveBeenCalled();
  });
});
