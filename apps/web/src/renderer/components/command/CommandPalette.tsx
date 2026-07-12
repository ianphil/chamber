import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch } from 'react';
import {
  Bot,
  Layout,
  MessageSquare,
  MessageSquarePlus,
  Plus,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { LensViewManifest, MindContext } from '@chamber/shared/types';
import type { ElectronAPI } from '@chamber/shared/electron-types';
import { useAppDispatch, useAppState } from '../../lib/store';
import type { AppAction, LensView } from '../../lib/store';
import { Logger } from '../../lib/logger';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../ui/command';

const log = Logger.create('CommandPalette');

const GROUP_VIEWS = 'Views';
const GROUP_AGENTS = 'Agents';
const GROUP_CONVERSATION = 'Conversation';

const INPUT_PLACEHOLDER = 'Type a command or search...';

/** Always-present views that exist on master, rendered first in the Views group. */
const STATIC_VIEWS: readonly { id: LensView; label: string; icon: LucideIcon }[] = [
  { id: 'chat', label: 'Open Chat', icon: MessageSquare },
  { id: 'chatroom', label: 'Open Chatroom', icon: Users },
  { id: 'settings', label: 'Open Settings', icon: Settings },
];

/** A single, self-contained palette entry. `perform` is pre-bound to its side effects. */
export interface PaletteCommand {
  id: string;
  label: string;
  group: string;
  icon: LucideIcon;
  keywords?: string[];
  perform: () => void;
}

/**
 * Mutable in-flight flag guarding against duplicate conversation creation. Shaped
 * like a React ref so the component can pass `useRef(false)` straight through.
 */
export interface CreationGuard {
  current: boolean;
}

/** Live state plus injected effects the commands act on. Kept injectable for testing. */
export interface CommandPaletteDeps {
  minds: MindContext[];
  discoveredViews: LensViewManifest[];
  activeMindId: string | null;
  /** True while the active mind is streaming or switching models; blocks conversation resets. */
  isActiveMindBusy: boolean;
  /** Shared in-flight flag so rapid repeat selections cannot spawn two sessions. */
  creationGuard: CreationGuard;
  dispatch: Dispatch<AppAction>;
  electronAPI: ElectronAPI;
}

function switchToMind(mind: MindContext, dispatch: Dispatch<AppAction>, electronAPI: ElectronAPI): void {
  // Mirror MindSidebar.handleSwitchMind: focus a popout window if the mind is
  // windowed, otherwise switch the active mind in the main window.
  if (mind.windowed) {
    void electronAPI.mind.openWindow(mind.mindId);
    return;
  }
  void electronAPI.mind.setActive(mind.mindId);
  dispatch({ type: 'SET_ACTIVE_MIND', payload: mind.mindId });
  dispatch({ type: 'SET_ACTIVE_VIEW', payload: 'chat' });
}

async function startNewConversation(
  mindId: string,
  dispatch: Dispatch<AppAction>,
  electronAPI: ElectronAPI,
  guard: CreationGuard,
): Promise<void> {
  // Mirror ConversationHistoryPanel.startNewConversation: skip if a creation is
  // already in flight, reset the backend session, then hydrate the fresh session.
  if (guard.current) return;
  guard.current = true;
  try {
    const result = await electronAPI.chat.newConversation(mindId);
    await electronAPI.chatroom.clear();
    dispatch({
      type: 'RESUME_CONVERSATION',
      payload: {
        mindId,
        sessionId: result.sessionId,
        messages: result.messages,
        conversations: result.conversations,
      },
    });
    dispatch({ type: 'SET_ACTIVE_VIEW', payload: 'chat' });
  } catch (error) {
    log.error('Failed to start new conversation from command palette:', error);
  } finally {
    guard.current = false;
  }
}

/**
 * Build the palette command list from live app state. Pure and side-effect free
 * to construct; each command's `perform` closure owns its dispatch / electron work.
 * Adding a future view is a one-line push, keeping the list trivially extensible.
 */
export function buildCommandItems(deps: CommandPaletteDeps): PaletteCommand[] {
  const { minds, discoveredViews, activeMindId, isActiveMindBusy, creationGuard, dispatch, electronAPI } = deps;
  const commands: PaletteCommand[] = [];

  for (const view of STATIC_VIEWS) {
    commands.push({
      id: `view:${view.id}`,
      label: view.label,
      group: GROUP_VIEWS,
      icon: view.icon,
      perform: () => dispatch({ type: 'SET_ACTIVE_VIEW', payload: view.id }),
    });
  }

  for (const view of discoveredViews) {
    commands.push({
      // Namespace discovered views under `lens:` so a Lens declaring a reserved
      // id (chat/chatroom/settings) cannot collide with a STATIC_VIEWS command.
      id: `lens:${view.id}`,
      label: `Open ${view.name}`,
      group: GROUP_VIEWS,
      icon: Layout,
      keywords: [view.name, view.id],
      perform: () => dispatch({ type: 'SET_ACTIVE_VIEW', payload: view.id }),
    });
  }

  for (const mind of minds) {
    commands.push({
      id: `mind:${mind.mindId}`,
      label: `Switch to ${mind.identity.name}`,
      group: GROUP_AGENTS,
      icon: Bot,
      keywords: [mind.identity.name, 'agent'],
      perform: () => switchToMind(mind, dispatch, electronAPI),
    });
  }

  commands.push({
    id: 'action:add-agent',
    label: 'Add agent',
    group: GROUP_AGENTS,
    icon: Plus,
    keywords: ['new agent', 'create mind'],
    perform: () => dispatch({ type: 'SHOW_LANDING' }),
  });

  // Omit conversation reset while the mind is streaming or switching models so the
  // palette cannot bypass the same guard the history panel enforces.
  if (activeMindId && !isActiveMindBusy) {
    commands.push({
      id: 'action:new-conversation',
      label: 'New conversation',
      group: GROUP_CONVERSATION,
      icon: MessageSquarePlus,
      keywords: ['reset chat', 'start over', 'clear'],
      perform: () => {
        void startNewConversation(activeMindId, dispatch, electronAPI, creationGuard);
      },
    });
  }

  return commands;
}

interface CommandGroupView {
  group: string;
  items: PaletteCommand[];
}

/** Group commands by their `group` field, preserving first-seen order. */
function groupCommands(commands: PaletteCommand[]): CommandGroupView[] {
  const groups: CommandGroupView[] = [];
  const byGroup = new Map<string, CommandGroupView>();
  for (const command of commands) {
    let view = byGroup.get(command.group);
    if (!view) {
      view = { group: command.group, items: [] };
      byGroup.set(command.group, view);
      groups.push(view);
    }
    view.items.push(command);
  }
  return groups;
}

/**
 * Global command palette. Opens on Cmd+K (mac) / Ctrl+K (win/linux), filters as
 * you type, runs the selected command, and closes on selection or Escape. Mounted
 * once by AppShell; it self-registers the global shortcut and cleans it up on unmount.
 */
export function CommandPalette() {
  const { minds, discoveredViews, activeMindId, streamingByMind, conversationViewByMind } = useAppState();
  const dispatch = useAppDispatch();
  const [open, setOpen] = useState(false);
  const creationGuard = useRef(false);

  // Mirror ConversationHistoryPanel: streaming or model-switching means the active
  // mind is busy and conversation resets must be withheld.
  const activeConversationView = activeMindId ? conversationViewByMind[activeMindId] : undefined;
  const isActiveMindBusy = activeMindId
    ? Boolean(streamingByMind[activeMindId] || activeConversationView?.streaming || activeConversationView?.modelSwitching)
    : false;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && (event.key === 'k' || event.key === 'K')) {
        event.preventDefault();
        setOpen((previous) => !previous);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const commands = useMemo(
    () => buildCommandItems({
      minds,
      discoveredViews,
      activeMindId,
      isActiveMindBusy,
      creationGuard,
      dispatch,
      electronAPI: window.electronAPI,
    }),
    [minds, discoveredViews, activeMindId, isActiveMindBusy, dispatch],
  );
  const groups = useMemo(() => groupCommands(commands), [commands]);

  const runCommand = useCallback((command: PaletteCommand) => {
    command.perform();
    setOpen(false);
  }, []);

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Command palette"
      description="Search for a command to run"
    >
      <CommandInput aria-label="Search commands" placeholder={INPUT_PLACEHOLDER} />
      <CommandList className="max-h-[400px]">
        <CommandEmpty>No results found.</CommandEmpty>
        {groups.map(({ group, items }) => (
          <CommandGroup key={group} heading={group}>
            {items.map((command) => {
              const Icon = command.icon;
              return (
                <CommandItem
                  key={command.id}
                  value={`${command.id} ${command.label} ${command.keywords?.join(' ') ?? ''}`}
                  onSelect={() => runCommand(command)}
                >
                  <Icon size={16} className="text-muted-foreground" aria-hidden />
                  <span>{command.label}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
