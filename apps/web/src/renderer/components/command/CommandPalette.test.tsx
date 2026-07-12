/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MindContext } from '@chamber/shared/types';
import { AppStateProvider } from '../../lib/store';
import type { AppState } from '../../lib/store/state';
import { installElectronAPI, mockElectronAPI, makeLensViewManifest } from '../../../test/helpers';
import { CommandPalette, buildCommandItems, type CommandPaletteDeps } from './CommandPalette';

// jsdom does not provide ResizeObserver; cmdk needs it.
class MockResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as unknown as { ResizeObserver: typeof MockResizeObserver }).ResizeObserver =
  MockResizeObserver;
// jsdom does not implement Element.scrollIntoView; cmdk calls it on focus.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {};
}

const mind: MindContext = {
  mindId: 'mind-1',
  mindPath: 'C:\\agents\\monica',
  identity: { name: 'Monica', systemMessage: '# Monica' },
  status: 'ready',
};

const PLACEHOLDER = 'Type a command or search...';
const NEW_CONVERSATION = 'action:new-conversation';

function makeDeps(overrides: Partial<CommandPaletteDeps> = {}): CommandPaletteDeps {
  return {
    minds: [],
    discoveredViews: [],
    activeMindId: null,
    isActiveMindBusy: false,
    creationGuard: { current: false },
    dispatch: vi.fn(),
    electronAPI: mockElectronAPI(),
    ...overrides,
  };
}

function renderPalette(testInitialState?: Partial<AppState>) {
  return render(
    <AppStateProvider testInitialState={testInitialState}>
      <CommandPalette />
    </AppStateProvider>,
  );
}

function pressCtrlK() {
  fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
}

describe('CommandPalette', () => {
  beforeEach(() => {
    installElectronAPI();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('is closed until the Ctrl+K shortcut is pressed', () => {
    renderPalette({ activeMindId: mind.mindId, minds: [mind] });
    expect(screen.queryByPlaceholderText(PLACEHOLDER)).toBeNull();

    pressCtrlK();

    expect(screen.getByPlaceholderText(PLACEHOLDER)).toBeTruthy();
  });

  it('also opens with the Meta+K shortcut for macOS', () => {
    renderPalette({ minds: [mind] });

    fireEvent.keyDown(document.body, { key: 'k', metaKey: true });

    expect(screen.getByPlaceholderText(PLACEHOLDER)).toBeTruthy();
  });

  it('toggles closed when Ctrl+K is pressed again', () => {
    renderPalette({ activeMindId: mind.mindId, minds: [mind] });

    pressCtrlK();
    expect(screen.getByPlaceholderText(PLACEHOLDER)).toBeTruthy();

    pressCtrlK();
    expect(screen.queryByPlaceholderText(PLACEHOLDER)).toBeNull();
  });

  it('closes when Escape is pressed', async () => {
    renderPalette({ activeMindId: mind.mindId, minds: [mind] });

    pressCtrlK();
    const input = screen.getByPlaceholderText(PLACEHOLDER);

    fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByPlaceholderText(PLACEHOLDER)).toBeNull();
    });
  });

  it('exposes an accessible label on the search input', () => {
    renderPalette({ activeMindId: mind.mindId, minds: [mind] });

    pressCtrlK();

    const input = screen.getByPlaceholderText(PLACEHOLDER);
    expect(input.getAttribute('aria-label')).toBe('Search commands');
  });

  it('filters the visible commands as the user types', async () => {
    renderPalette({ activeMindId: null, minds: [] });

    pressCtrlK();
    fireEvent.change(screen.getByPlaceholderText(PLACEHOLDER), { target: { value: 'settings' } });

    await waitFor(() => {
      const labels = screen.getAllByRole('option').map((option) => option.textContent);
      expect(labels).toContain('Open Settings');
      expect(labels).not.toContain('Open Chat');
      expect(labels).not.toContain('Open Chatroom');
    });
  });

  it('dispatches SET_ACTIVE_VIEW when the Open Settings command runs', () => {
    const dispatch = vi.fn();
    const commands = buildCommandItems(makeDeps({ dispatch }));

    const settings = commands.find((command) => command.id === 'view:settings');
    expect(settings).toBeDefined();
    settings?.perform();

    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_ACTIVE_VIEW', payload: 'settings' });
  });

  it('switches the active mind through electron and the store', () => {
    const dispatch = vi.fn();
    const electronAPI = mockElectronAPI();
    const commands = buildCommandItems(
      makeDeps({ minds: [mind], activeMindId: mind.mindId, dispatch, electronAPI }),
    );

    const switchCommand = commands.find((command) => command.id === `mind:${mind.mindId}`);
    expect(switchCommand).toBeDefined();
    switchCommand?.perform();

    expect(electronAPI.mind.setActive).toHaveBeenCalledWith(mind.mindId);
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_ACTIVE_MIND', payload: mind.mindId });
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_ACTIVE_VIEW', payload: 'chat' });
  });

  it('offers the new conversation command only for an idle active mind', () => {
    const withoutMind = buildCommandItems(makeDeps());
    expect(withoutMind.some((command) => command.id === NEW_CONVERSATION)).toBe(false);

    const idleMind = buildCommandItems(makeDeps({ minds: [mind], activeMindId: mind.mindId }));
    expect(idleMind.some((command) => command.id === NEW_CONVERSATION)).toBe(true);
  });

  it('namespaces discovered Lens view commands so they cannot collide with reserved view ids', () => {
    const dispatch = vi.fn();
    const commands = buildCommandItems(
      makeDeps({ dispatch, discoveredViews: [makeLensViewManifest({ id: 'chat', name: 'Custom Chat' })] }),
    );

    const ids = commands.map((command) => command.id);
    expect(ids).toContain('view:chat');
    expect(ids).toContain('lens:chat');

    commands.find((command) => command.id === 'lens:chat')?.perform();
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_ACTIVE_VIEW', payload: 'chat' });
  });

  it('omits the new conversation command while the active mind is busy', () => {
    const busy = buildCommandItems(
      makeDeps({ minds: [mind], activeMindId: mind.mindId, isActiveMindBusy: true }),
    );
    expect(busy.some((command) => command.id === NEW_CONVERSATION)).toBe(false);
  });

  it('hides the new conversation command while the active mind is streaming', async () => {
    renderPalette({
      activeMindId: mind.mindId,
      minds: [mind],
      streamingByMind: { [mind.mindId]: true },
    });

    pressCtrlK();
    await screen.findByPlaceholderText(PLACEHOLDER);

    expect(screen.getByText('Open Chat')).toBeTruthy();
    expect(screen.queryByText('New conversation')).toBeNull();
  });

  it('guards against duplicate concurrent conversation creation', async () => {
    const electronAPI = mockElectronAPI();
    let resolveNewConversation: (value: { sessionId: string; messages: []; conversations: [] }) => void = () => {};
    (electronAPI.chat.newConversation as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise((resolve) => { resolveNewConversation = resolve; }),
    );
    const creationGuard = { current: false };
    const commands = buildCommandItems(
      makeDeps({ minds: [mind], activeMindId: mind.mindId, creationGuard, electronAPI }),
    );
    const newConversation = commands.find((command) => command.id === NEW_CONVERSATION);
    expect(newConversation).toBeDefined();

    newConversation?.perform();
    newConversation?.perform();

    expect(electronAPI.chat.newConversation).toHaveBeenCalledTimes(1);

    resolveNewConversation({ sessionId: 's1', messages: [], conversations: [] });
    await waitFor(() => expect(creationGuard.current).toBe(false));

    newConversation?.perform();
    expect(electronAPI.chat.newConversation).toHaveBeenCalledTimes(2);
  });
});
