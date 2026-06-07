/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationSummary, MindContext } from '@chamber/shared/types';
import { installElectronAPI, mockElectronAPI } from '../../../test/helpers';
import { AppStateProvider } from '../../lib/store';
import type { AppState } from '../../lib/store/state';
import { ConversationHistoryPanel } from './ConversationHistoryPanel';

const STORAGE_KEY = 'chamber:conversation-history-collapsed';

const mind: MindContext = {
  mindId: 'mind-1',
  mindPath: 'C:\\agents\\monica',
  identity: { name: 'Monica', systemMessage: '# Monica' },
  status: 'ready',
};

describe('ConversationHistoryPanel', () => {
  let api: ReturnType<typeof mockElectronAPI>;

  beforeEach(() => {
    localStorage.clear();
    api = installElectronAPI();
    (api.conversationHistory.list as ReturnType<typeof vi.fn>).mockReturnValue(new Promise<ConversationSummary[]>(() => undefined));
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('starts expanded and persists collapse toggles', async () => {
    renderHistoryPanel({ activeMindId: mind.mindId, minds: [mind], conversationHistoryByMind: { [mind.mindId]: [] } });

    const history = screen.getByLabelText('Conversation history');
    expect(history.style.width).not.toBe('');
    expect(history.className).not.toContain('w-10');
    expect(screen.getByRole('button', { name: 'Collapse history panel' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Collapse history panel' }));

    expect(history.className).toContain('w-10');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('true');
    expect(screen.getByRole('button', { name: 'Expand history panel' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Expand history panel' }));

    expect(history.className).not.toContain('w-10');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('false');
  });

  it('restores the saved collapsed preference while preserving the history landmark', () => {
    localStorage.setItem(STORAGE_KEY, 'true');

    renderHistoryPanel({ activeMindId: mind.mindId, minds: [mind], conversationHistoryByMind: { [mind.mindId]: [] } });

    const history = screen.getByLabelText('Conversation history');
    expect(history.className).toContain('w-10');
    expect(within(history).getByRole('button', { name: 'Expand history panel' })).toBeTruthy();
  });

  it('auto-collapses below the lg breakpoint without writing the storage key', () => {
    Object.defineProperty(window, 'innerWidth', { value: 900, configurable: true, writable: true });
    try {
      renderHistoryPanel({ activeMindId: mind.mindId, minds: [mind], conversationHistoryByMind: { [mind.mindId]: [] } });

      const history = screen.getByLabelText('Conversation history');
      expect(history.className).toContain('w-10');
      // Auto-collapse must not bake into the user's saved preference.
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    } finally {
      Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true, writable: true });
    }
  });

  it('lets the user override auto-collapse while narrow without losing their preference on widen', () => {
    Object.defineProperty(window, 'innerWidth', { value: 900, configurable: true, writable: true });
    try {
      renderHistoryPanel({ activeMindId: mind.mindId, minds: [mind], conversationHistoryByMind: { [mind.mindId]: [] } });

      const history = screen.getByLabelText('Conversation history');
      expect(history.className).toContain('w-10');

      fireEvent.click(screen.getByRole('button', { name: 'Expand history panel' }));
      expect(history.className).not.toContain('w-10');
    } finally {
      Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true, writable: true });
    }
  });

  it('groups conversations into Today / Yesterday / Older buckets', () => {
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const lastWeek = new Date(now);
    lastWeek.setDate(lastWeek.getDate() - 7);

    renderHistoryPanel({
      activeMindId: mind.mindId,
      minds: [mind],
      conversationHistoryByMind: {
        [mind.mindId]: [
          makeConversation({ sessionId: 's1', title: 'Today thread', updatedAt: now.toISOString() }),
          makeConversation({ sessionId: 's2', title: 'Yesterday thread', updatedAt: yesterday.toISOString() }),
          makeConversation({ sessionId: 's3', title: 'Older thread', updatedAt: lastWeek.toISOString() }),
        ],
      },
    });

    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getByText('Yesterday')).toBeTruthy();
    expect(screen.getByText('Older')).toBeTruthy();
    expect(screen.getByText('Today thread')).toBeTruthy();
    expect(screen.getByText('Yesterday thread')).toBeTruthy();
    expect(screen.getByText('Older thread')).toBeTruthy();
  });

  it('strips the absolute timestamp from auto-titled rows', () => {
    renderHistoryPanel({
      activeMindId: mind.mindId,
      minds: [mind],
      conversationHistoryByMind: {
        [mind.mindId]: [
          makeConversation({
            sessionId: 'auto-1',
            title: 'New chat · 6/3/2026, 9:39:42 AM',
          }),
        ],
      },
    });

    expect(screen.getByText('New chat')).toBeTruthy();
    expect(screen.queryByText('New chat · 6/3/2026, 9:39:42 AM')).toBeNull();
  });

  it('shows a keyboard hint chip row under the inline rename input', () => {
    const conversation = makeConversation({ title: 'Renamable' });
    renderHistoryPanel({
      activeMindId: mind.mindId,
      minds: [mind],
      conversationHistoryByMind: { [mind.mindId]: [conversation] },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Rename Renamable' }));

    expect(screen.getByText(/save/)).toBeTruthy();
    expect(screen.getByText(/cancel/)).toBeTruthy();
  });

  it('distinguishes no selected agent, loading history, and empty selected history', async () => {
    renderHistoryPanel({ activeMindId: null, minds: [] });
    expect(screen.getByText('Select an agent to see history')).toBeTruthy();
    expect(api.conversationHistory.list).not.toHaveBeenCalled();
    cleanup();

    renderHistoryPanel({ activeMindId: mind.mindId, minds: [mind] });
    expect(await screen.findByTestId('history-skeleton')).toBeTruthy();
    cleanup();

    (api.conversationHistory.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderHistoryPanel({ activeMindId: mind.mindId, minds: [mind] });
    expect(await screen.findByText('No conversations yet')).toBeTruthy();
  });

  it('does not retry a rejected automatic conversation resume for the same selected session', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const conversation = makeConversation({ title: 'Locked chat' });
    (api.conversationHistory.resume as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Cannot switch conversations while a message is still streaming.'),
    );

    renderHistoryPanel({
      activeMindId: mind.mindId,
      minds: [mind],
      conversationHistoryByMind: { [mind.mindId]: [conversation] },
      activeConversationByMind: { [mind.mindId]: conversation.sessionId },
      conversationViewByMind: {
        [mind.mindId]: {
          status: 'idle',
          sessionId: conversation.sessionId,
          streaming: false,
          modelSwitching: false,
        },
      },
    });

    await waitFor(() => {
      expect(api.conversationHistory.resume).toHaveBeenCalledTimes(1);
    });
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(api.conversationHistory.resume).toHaveBeenCalledTimes(1);
    expect((await screen.findByRole('alert')).textContent).toBe('Cannot switch conversations while a message is still streaming.');
    warn.mockRestore();
  });

  it('keeps row actions visible for keyboard focus', () => {
    const conversation = makeConversation({ title: 'Planning thread' });
    renderHistoryPanel({
      activeMindId: mind.mindId,
      minds: [mind],
      conversationHistoryByMind: { [mind.mindId]: [conversation] },
      activeConversationByMind: { [mind.mindId]: conversation.sessionId },
      conversationViewByMind: { [mind.mindId]: { status: 'ready', sessionId: conversation.sessionId, streaming: false, modelSwitching: false } },
    });    const rename = screen.getByRole('button', { name: 'Rename Planning thread' });
    const deleteButton = screen.getByRole('button', { name: 'Delete Planning thread' });

    // Default opacity must be perceivable (not opacity-0) so keyboard users and
    // anyone scanning the row can discover the actions without precise hover.
    expect(rename.className).toContain('opacity-40');
    expect(rename.className).not.toContain('opacity-0');
    expect(rename.className).toContain('group-focus-within:opacity-100');
    expect(rename.className).toContain('focus-visible:opacity-100');
    // Tooltip label is rendered via Radix portal (not visible until hover),
    // so we assert the accessible aria-label survives the wrapper migration.
    expect(rename.getAttribute('aria-label')).toBe('Rename Planning thread');
    expect(deleteButton.className).toContain('opacity-40');
    expect(deleteButton.className).not.toContain('opacity-0');
    expect(deleteButton.className).toContain('group-focus-within:opacity-100');
    expect(deleteButton.className).toContain('focus-visible:opacity-100');
    expect(deleteButton.getAttribute('aria-label')).toBe('Delete Planning thread');
    expect(screen.getByText(/just now/).parentElement?.className).toContain('text-xs');
  });

  it('confirms before deleting conversations with messages', async () => {
    const conversation = makeConversation({ title: 'Keep me honest', hasMessages: true });
    (api.conversationHistory.list as ReturnType<typeof vi.fn>).mockResolvedValue([conversation]);
    (api.conversationHistory.delete as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessionId: conversation.sessionId,
      messages: [],
      conversations: [],
    });
    renderHistoryPanel({
      activeMindId: mind.mindId,
      minds: [mind],
      conversationHistoryByMind: { [mind.mindId]: [conversation] },
      activeConversationByMind: { [mind.mindId]: conversation.sessionId },
      conversationViewByMind: { [mind.mindId]: { status: 'ready', sessionId: conversation.sessionId, streaming: false, modelSwitching: false } },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Delete Keep me honest' }));

    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getByText('Delete "Keep me honest"?')).toBeTruthy();
    expect(api.conversationHistory.delete).not.toHaveBeenCalled();

    // Cancel button must use a foreground-contrast token, not muted-foreground,
    // so it stays legible on the dark dialog surface.
    const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
    expect(cancelBtn.className).toContain('text-foreground');
    expect(cancelBtn.className).not.toContain('text-muted-foreground');

    fireEvent.click(screen.getByRole('button', { name: 'Delete conversation' }));

    await waitFor(() => {
      expect(api.conversationHistory.delete).toHaveBeenCalledWith(mind.mindId, conversation.sessionId);
    });
  });

  it('deletes empty conversations without confirmation', async () => {
    const conversation = makeConversation({ title: 'Empty draft', hasMessages: false });
    (api.conversationHistory.list as ReturnType<typeof vi.fn>).mockResolvedValue([conversation]);
    (api.conversationHistory.delete as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessionId: conversation.sessionId,
      messages: [],
      conversations: [],
    });
    renderHistoryPanel({
      activeMindId: mind.mindId,
      minds: [mind],
      conversationHistoryByMind: { [mind.mindId]: [conversation] },
      activeConversationByMind: { [mind.mindId]: conversation.sessionId },
      conversationViewByMind: { [mind.mindId]: { status: 'ready', sessionId: conversation.sessionId, streaming: false, modelSwitching: false } },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Delete Empty draft' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => {
      expect(api.conversationHistory.delete).toHaveBeenCalledWith(mind.mindId, conversation.sessionId);
    });
  });
});

function renderHistoryPanel(testInitialState?: Partial<AppState>) {
  render(
    <AppStateProvider testInitialState={testInitialState}>
      <ConversationHistoryPanel />
    </AppStateProvider>,
  );
}

function makeConversation(overrides?: Partial<ConversationSummary>): ConversationSummary {
  const now = new Date().toISOString();
  return {
    sessionId: 'session-1',
    title: 'Planning thread',
    createdAt: now,
    updatedAt: now,
    kind: 'chat',
    active: true,
    hasMessages: true,
    ...overrides,
  };
}
