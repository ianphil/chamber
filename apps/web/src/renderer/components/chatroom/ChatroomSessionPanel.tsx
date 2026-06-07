/**
 * ChatroomSessionPanel
 *
 * Right-side sidebar for the Chatroom view. Mirrors the structure and a11y
 * conventions of ConversationHistoryPanel (groups, hover-revealed Rename /
 * Delete actions with always-on opacity-40, inline rename with kbd hint chips,
 * keyboard-focusable destructive actions, dark-dialog-safe confirm) but is
 * scoped to app-global chatroom sessions instead of per-mind conversations.
 *
 * Lifecycle:
 *   - On mount + on Chatroom view, fetch sessions from electronAPI.chatroom.
 *   - SET_CHATROOM_SESSIONS keeps the sidebar fresh after create/rename/delete.
 *   - RESUME_CHATROOM_SESSION fans active session + transcript into the store
 *     so ChatroomPanel can render it.
 *   - CLEAR_ACTIVE_CHATROOM_SESSION drops the panel to its picker state.
 */
import { ChevronLeft, ChevronRight, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { getErrorMessage } from '@chamber/shared/getErrorMessage';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatroomSessionSummary } from '@chamber/shared/chatroom-types';
import { useAppDispatch, useAppState } from '../../lib/store';
import { useResizableWidth } from '../../hooks/useResizableWidth';
import { Logger } from '../../lib/logger';
import { TooltipFor } from '../ui/tooltip';
import { cn, formatRelativeTime } from '../../lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';

const log = Logger.create('ChatroomSessionPanel');
const COLLAPSED_STORAGE_KEY = 'chamber:chatroom-session-panel-collapsed';
const WIDTH_STORAGE_KEY = 'chamber:chatroom-session-panel-width';

export function ChatroomSessionPanel() {
  const { chatroomSessions, activeChatroomSessionId } = useAppState();
  const dispatch = useAppDispatch();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [pendingDeleteSession, setPendingDeleteSession] = useState<ChatroomSessionSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(() => localStorage.getItem(COLLAPSED_STORAGE_KEY) === 'true');
  // Sessions are the user's only way to navigate between chatrooms and to
  // create new ones from the sidebar. Unlike per-mind chat history (which is
  // a secondary surface), keep this panel expanded by default and respect
  // ONLY the user's explicit collapse preference. Auto-collapse on narrow
  // viewports was making users miss the "+ New chatroom" affordance entirely.
  const displayCollapsed = isCollapsed;
  const { width, handleProps, reset: resetWidth } = useResizableWidth({
    storageKey: WIDTH_STORAGE_KEY,
    defaultWidth: 320,
    min: 240,
    max: 560,
  });
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Hydrate the session list when the panel mounts and after deletions /
  // renames so it stays in sync with the on-disk store.
  const refreshSessions = useCallback(async () => {
    try {
      const sessions = await window.electronAPI.chatroom.listSessions();
      dispatch({ type: 'SET_CHATROOM_SESSIONS', payload: sessions });
    } catch (err) {
      log.warn('Failed to load chatroom sessions:', err);
    }
  }, [dispatch]);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  useEffect(() => {
    if (renamingId) {
      setTimeout(() => renameInputRef.current?.select(), 0);
    }
  }, [renamingId]);

  const setCollapsed = (next: boolean) => {
    setIsCollapsed(next);
    localStorage.setItem(COLLAPSED_STORAGE_KEY, String(next));
  };

  /**
   * Drop the active session and refresh the list. The actual new session is
   * created lazily by ChatroomPanel on first Send -- this button just clears
   * the active marker so the user lands in the picker without piling up
   * empty "New chatroom" rows in the sidebar.
   */
  const handleStartNew = async () => {
    if (busy) return;
    setBusy(true);
    try {
      dispatch({ type: 'CLEAR_ACTIVE_CHATROOM_SESSION' });
      const sessions = await window.electronAPI.chatroom.listSessions();
      dispatch({ type: 'SET_CHATROOM_SESSIONS', payload: sessions });
    } catch (err) {
      log.error('Failed to start a new chatroom:', getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleResume = async (session: ChatroomSessionSummary) => {
    if (busy) return;
    if (session.sessionId === activeChatroomSessionId) return;
    setBusy(true);
    try {
      const resumed = await window.electronAPI.chatroom.resumeSession(session.sessionId);
      const sessions = await window.electronAPI.chatroom.listSessions();
      dispatch({ type: 'RESUME_CHATROOM_SESSION', payload: { ...resumed, sessions } });
    } catch (err) {
      log.error('Failed to resume chatroom session:', getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const startRename = (session: ChatroomSessionSummary) => {
    setRenamingId(session.sessionId);
    setRenameValue(session.title);
  };

  const completeRename = async (sessionId: string, title: string | null) => {
    if (title) {
      try {
        const sessions = await window.electronAPI.chatroom.renameSession(sessionId, title);
        dispatch({ type: 'SET_CHATROOM_SESSIONS', payload: sessions });
      } catch (err) {
        log.error('Rename failed:', getErrorMessage(err));
      }
    }
    setRenamingId(null);
  };

  const handleRenameKeyDown = (event: React.KeyboardEvent<HTMLInputElement>, id: string) => {
    if (event.key === 'Enter') {
      void completeRename(id, renameValue.trim() || null);
    } else if (event.key === 'Escape') {
      setRenamingId(null);
    }
  };

  const performDelete = async (session: ChatroomSessionSummary) => {
    setBusy(true);
    try {
      const sessions = await window.electronAPI.chatroom.deleteSession(session.sessionId);
      dispatch({ type: 'SET_CHATROOM_SESSIONS', payload: sessions });
      if (session.sessionId === activeChatroomSessionId) {
        dispatch({ type: 'CLEAR_ACTIVE_CHATROOM_SESSION' });
      }
    } catch (err) {
      log.error('Delete failed:', getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const requestDelete = (session: ChatroomSessionSummary) => {
    if (busy) return;
    if (session.hasMessages) {
      setPendingDeleteSession(session);
      return;
    }
    void performDelete(session);
  };

  const confirmDelete = () => {
    const session = pendingDeleteSession;
    if (!session) return;
    setPendingDeleteSession(null);
    void performDelete(session);
  };

  return (
    <aside
      aria-label="Chatroom sessions"
      className={cn(
        'surface-panel relative shrink-0 bg-card/65 border border-border rounded-xl overflow-hidden flex flex-col',
        displayCollapsed && 'w-10',
      )}
      style={displayCollapsed ? undefined : { width }}
    >
      {!displayCollapsed && (
        <div
          {...handleProps}
          onDoubleClick={resetWidth}
          aria-label="Resize chatroom sessions panel"
          className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize z-10 hover:bg-foreground/20 active:bg-foreground/30 transition-colors"
        />
      )}
      {displayCollapsed ? (
        <TooltipFor label="Expand chatrooms" side="left">
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="m-1 h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring flex items-center justify-center"
            aria-label="Expand chatroom sessions"
          >
            <ChevronLeft size={15} />
          </button>
        </TooltipFor>
      ) : (
        <>
          <div className="h-10 border-b border-border px-3 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <TooltipFor label="Collapse chatrooms">
                <button
                  type="button"
                  onClick={() => setCollapsed(true)}
                  className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring flex items-center justify-center"
                  aria-label="Collapse chatroom sessions"
                >
                  <ChevronRight size={15} />
                </button>
              </TooltipFor>
              <Users size={12} className="text-muted-foreground" aria-hidden />
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Chatrooms
              </span>
            </div>
            <TooltipFor label="New chatroom (created on first message)">
              <button
                type="button"
                disabled={busy}
                onClick={() => { void handleStartNew(); }}
                className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring flex items-center justify-center disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                aria-label="New chatroom"
              >
                <Plus size={15} />
              </button>
            </TooltipFor>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {chatroomSessions.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">
                No chatrooms yet. Click <kbd className="rounded border border-border bg-muted px-1 py-0.5 text-[10px] font-mono">+</kbd> above to start one.
              </p>
            ) : (
              chatroomSessions.map((session) => {
                const isSelected = session.sessionId === activeChatroomSessionId || session.active;
                return (
                  <div
                    key={session.sessionId}
                    className={cn(
                      'group flex items-center gap-2 rounded-lg border-l-2 px-2 py-2 transition-colors',
                      isSelected
                        ? 'border-l-foreground bg-selected text-foreground'
                        : 'border-l-transparent text-muted-foreground hover:text-foreground hover:bg-hover',
                    )}
                  >
                    <button
                      type="button"
                      aria-label={`Resume chatroom ${session.title}`}
                      disabled={busy}
                      onClick={() => { void handleResume(session); }}
                      className="min-w-0 flex-1 text-left disabled:cursor-not-allowed"
                    >
                      {renamingId === session.sessionId ? (
                        <div className="space-y-1">
                          <input
                            ref={renameInputRef}
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => handleRenameKeyDown(e, session.sessionId)}
                            onBlur={() => { void completeRename(session.sessionId, renameValue.trim() || null); }}
                            className="w-full rounded border border-primary bg-background px-1.5 py-0.5 text-sm text-foreground outline-none"
                          />
                          <p className="text-[10px] text-muted-foreground/80">
                            <kbd className="rounded border border-border bg-muted px-1 py-0.5 text-[9px] font-mono">↵</kbd> save · <kbd className="rounded border border-border bg-muted px-1 py-0.5 text-[9px] font-mono">esc</kbd> cancel
                          </p>
                        </div>
                      ) : (
                        <>
                          <div className="truncate text-sm font-medium">{session.title}</div>
                          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                            <span>{formatRelativeTime(session.updatedAt)}</span>
                            {session.active ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-genesis/15 px-1.5 py-px text-[10px] font-medium text-genesis">
                                <span className="h-1.5 w-1.5 rounded-full bg-genesis animate-pulse" />
                                Active
                              </span>
                            ) : null}
                          </div>
                        </>
                      )}
                    </button>

                    <div className="flex items-center">
                      <TooltipFor label="Rename">
                        <button
                          type="button"
                          onClick={() => startRename(session)}
                          disabled={busy}
                          className="h-7 w-7 rounded-md text-muted-foreground opacity-40 hover:text-foreground hover:bg-accent hover:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring flex items-center justify-center disabled:cursor-not-allowed disabled:opacity-30"
                          aria-label={`Rename ${session.title}`}
                        >
                          <Pencil size={13} />
                        </button>
                      </TooltipFor>
                      <TooltipFor label="Delete">
                        <button
                          type="button"
                          onClick={() => requestDelete(session)}
                          disabled={busy}
                          className="h-7 w-7 rounded-md text-muted-foreground opacity-40 hover:text-destructive hover:bg-destructive/10 hover:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring flex items-center justify-center disabled:cursor-not-allowed disabled:opacity-30"
                          aria-label={`Delete ${session.title}`}
                        >
                          <Trash2 size={13} />
                        </button>
                      </TooltipFor>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

      <Dialog
        open={pendingDeleteSession !== null}
        onOpenChange={(open) => { if (!open && !busy) setPendingDeleteSession(null); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete &ldquo;{pendingDeleteSession?.title}&rdquo;?</DialogTitle>
            <DialogDescription>
              This chatroom and its transcript cannot be restored after it is deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setPendingDeleteSession(null)}
              disabled={busy}
              className="rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmDelete}
              disabled={busy}
              className="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
            >
              Delete chatroom
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
