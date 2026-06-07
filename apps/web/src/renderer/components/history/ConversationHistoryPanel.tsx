import { ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { getErrorMessage } from '@chamber/shared/getErrorMessage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ConversationSummary } from '@chamber/shared/types';
import { useAppDispatch, useAppState } from '../../lib/store';
import { useResponsiveLayout } from '../../hooks/useResponsiveLayout';
import { useResizableWidth } from '../../hooks/useResizableWidth';
import { useDelayedFlag } from '../../hooks/useDelayedFlag';
import { Logger } from '../../lib/logger';
import { cn, formatRelativeTime } from '../../lib/utils';
import { TooltipFor } from '../ui/tooltip';
import { Skeleton } from '../ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';

const log = Logger.create('ConversationHistoryPanel');
const HISTORY_COLLAPSED_STORAGE_KEY = 'chamber:conversation-history-collapsed';
const HISTORY_WIDTH_STORAGE_KEY = 'chamber:conversation-history-width';

// Placeholder rows shown while a mind's history is loading. Mirrors the real
// grouped-row layout (bucket heading + indented rows) so the panel reserves
// space and doesn't jump when conversations arrive.
function HistorySkeleton() {
  return (
    <div data-testid="history-skeleton" className="space-y-3">
      {[3, 2].map((rows, group) => (
        <section key={group}>
          <Skeleton className="mx-2 mb-2 h-2.5 w-16" />
          <div className="space-y-1">
            {Array.from({ length: rows }).map((_, row) => (
              <div key={row} className="flex flex-col gap-1.5 px-2 py-2">
                <Skeleton className="h-3 w-[80%]" />
                <Skeleton className="h-2 w-12" />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export function ConversationHistoryPanel() {
  const { activeMindId, conversationHistoryByMind, activeConversationByMind, conversationViewByMind, streamingByMind } = useAppState();
  const dispatch = useAppDispatch();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [isCreatingConversation, setIsCreatingConversation] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDeleteConversation, setPendingDeleteConversation] = useState<ConversationSummary | null>(null);
  const [loadingMindId, setLoadingMindId] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(() => localStorage.getItem(HISTORY_COLLAPSED_STORAGE_KEY) === 'true');
  const { shouldAutoCollapseHistory } = useResponsiveLayout();
  // Below `lg`, auto-collapse unless the user has explicitly expanded since the
  // last narrow event. The explicit-expand bit is per-session (resets on reload).
  const [explicitlyExpandedWhileNarrow, setExplicitlyExpandedWhileNarrow] = useState(false);
  useEffect(() => {
    if (!shouldAutoCollapseHistory) setExplicitlyExpandedWhileNarrow(false);
  }, [shouldAutoCollapseHistory]);
  const displayCollapsed = isCollapsed || (shouldAutoCollapseHistory && !explicitlyExpandedWhileNarrow);
  const { width, handleProps, reset: resetWidth } = useResizableWidth({
    storageKey: HISTORY_WIDTH_STORAGE_KEY,
    defaultWidth: 320,
    min: 240,
    max: 560,
  });
  const renameInputRef = useRef<HTMLInputElement>(null);
  const creatingConversationRef = useRef(false);

  const conversations = useMemo<ConversationSummary[] | undefined>(() => {
    if (!activeMindId) return undefined;
    return conversationHistoryByMind[activeMindId];
  }, [activeMindId, conversationHistoryByMind]);
  const visibleConversations = conversations ?? [];
  const selectedConversationId = activeMindId ? activeConversationByMind[activeMindId] : undefined;
  const activeConversationView = activeMindId ? conversationViewByMind[activeMindId] : undefined;
  const isActiveMindStreaming = activeMindId
    ? Boolean(streamingByMind[activeMindId] || activeConversationView?.streaming)
    : false;
  const isActiveMindBusy = isActiveMindStreaming || Boolean(activeConversationView?.modelSwitching);
  const isHistoryLoading = Boolean(activeMindId && loadingMindId === activeMindId && conversations === undefined);
  // Grace-gate the skeleton so a fast history fetch doesn't flash a pulse.
  const showHistorySkeleton = useDelayedFlag(isHistoryLoading);
  const selectedConversationError = selectedConversationId && activeConversationView?.sessionId === selectedConversationId
    ? activeConversationView.error
    : undefined;

  const applyResumeResult = useCallback((mindId: string, result: Awaited<ReturnType<typeof window.electronAPI.conversationHistory.resume>>) => {
    dispatch({
      type: 'RESUME_CONVERSATION',
      payload: {
        mindId,
        sessionId: result.sessionId,
        messages: result.messages,
        conversations: result.conversations,
      },
    });
  }, [dispatch]);

  const hydrateConversation = useCallback(async (mindId: string, sessionId: string) => {
    dispatch({ type: 'CONVERSATION_HYDRATING', payload: { mindId, sessionId } });
    try {
      const result = await window.electronAPI.conversationHistory.resume(mindId, sessionId);
      applyResumeResult(mindId, result);
      return result;
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      dispatch({ type: 'CONVERSATION_HYDRATE_FAILED', payload: { mindId, sessionId, error: message } });
      log.warn('Failed to hydrate conversation:', error);
      throw error;
    }
  }, [applyResumeResult, dispatch]);

  useEffect(() => {
    if (!activeMindId) return;
    let cancelled = false;
    if (conversationHistoryByMind[activeMindId] === undefined) {
      setLoadingMindId(activeMindId);
    }
    window.electronAPI.conversationHistory.list(activeMindId).then((history) => {
      if (cancelled) return;
      dispatch({ type: 'SET_CONVERSATION_HISTORY', payload: { mindId: activeMindId, conversations: history } });
      setLoadingMindId((current) => current === activeMindId ? null : current);
    }).catch((error: unknown) => {
      log.warn('Failed to load conversation history:', error);
      if (!cancelled) {
        // Record an empty history so the chat pane settles to its welcome
        // state instead of waiting forever on a hydrating skeleton.
        dispatch({ type: 'SET_CONVERSATION_HISTORY', payload: { mindId: activeMindId, conversations: [] } });
        setLoadingMindId((current) => current === activeMindId ? null : current);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeMindId, dispatch]);

  useEffect(() => {
    if (!activeMindId || !selectedConversationId || isActiveMindBusy || creatingConversationRef.current) return;
    if (activeConversationView?.status === 'hydrating' && activeConversationView.pendingSessionId === selectedConversationId) return;
    if (activeConversationView?.status === 'ready' && activeConversationView.sessionId === selectedConversationId) return;
    if (
      activeConversationView?.status === 'idle'
      && activeConversationView.sessionId === selectedConversationId
      && activeConversationView.error
    ) return;

    void hydrateConversation(activeMindId, selectedConversationId).catch(() => {
      // The reducer records the failure; the warning above preserves diagnostics.
    });
  }, [
    activeConversationView?.error,
    activeConversationView?.pendingSessionId,
    activeConversationView?.sessionId,
    activeConversationView?.status,
    activeMindId,
    hydrateConversation,
    isActiveMindBusy,
    selectedConversationId,
  ]);

  useEffect(() => {
    if (renamingId) {
      setTimeout(() => renameInputRef.current?.select(), 0);
    }
  }, [renamingId]);

  const startRename = (conversation: ConversationSummary) => {
    setRenamingId(conversation.sessionId);
    setRenameValue(conversation.title);
  };

  const completeRename = async (sessionId: string, title: string | null) => {
    if (title && activeMindId) {
      const history = await window.electronAPI.conversationHistory.rename(activeMindId, sessionId, title);
      dispatch({ type: 'SET_CONVERSATION_HISTORY', payload: { mindId: activeMindId, conversations: history } });
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

  const resumeConversation = async (sessionId: string) => {
    if (!activeMindId || isActiveMindBusy) return;
    if (
      sessionId === selectedConversationId
      && activeConversationView?.status === 'ready'
      && activeConversationView.sessionId === sessionId
    ) return;
    try {
      await hydrateConversation(activeMindId, sessionId);
    } catch {
      return;
    }
    dispatch({ type: 'SET_ACTIVE_VIEW', payload: 'chat' });
  };

  const startNewConversation = async () => {
    if (!activeMindId || isActiveMindBusy || isCreatingConversation) return;
    creatingConversationRef.current = true;
    setIsCreatingConversation(true);
    try {
      const result = await window.electronAPI.chat.newConversation(activeMindId);
      await window.electronAPI.chatroom.clear();
      applyResumeResult(activeMindId, result);
      dispatch({ type: 'SET_ACTIVE_VIEW', payload: 'chat' });
    } catch (error) {
      log.error('Failed to start new conversation:', error);
    } finally {
      creatingConversationRef.current = false;
      setIsCreatingConversation(false);
    }
  };

  const setCollapsed = (nextCollapsed: boolean) => {
    setIsCollapsed(nextCollapsed);
    localStorage.setItem(HISTORY_COLLAPSED_STORAGE_KEY, String(nextCollapsed));
    // If user explicitly expands while the viewport is narrow, remember that so
    // we don't immediately auto-collapse them again on the next render.
    if (!nextCollapsed && shouldAutoCollapseHistory) {
      setExplicitlyExpandedWhileNarrow(true);
    } else if (nextCollapsed) {
      setExplicitlyExpandedWhileNarrow(false);
    }
  };

  const performDeleteConversation = async (conversation: ConversationSummary) => {
    if (!activeMindId || isActiveMindBusy || deletingId) return;

    setDeletingId(conversation.sessionId);
    setRenamingId(null);
    try {
      const result = await window.electronAPI.conversationHistory.delete(activeMindId, conversation.sessionId);
      if (conversation.active) {
        applyResumeResult(activeMindId, result);
        dispatch({ type: 'SET_ACTIVE_VIEW', payload: 'chat' });
      } else {
        // Inactive delete: don't replace the active conversation's messages — the SDK→ChatMessage
        // mapping is text-only and would drop tool-calls/reasoning/images from the live chat UI.
        dispatch({
          type: 'SET_CONVERSATION_HISTORY',
          payload: { mindId: activeMindId, conversations: result.conversations },
        });
      }
    } catch (error) {
      log.error('Failed to delete conversation:', error);
    } finally {
      setDeletingId(null);
    }
  };

  const deleteConversation = async (conversation: ConversationSummary) => {
    if (!activeMindId || isActiveMindBusy || deletingId) return;
    if (conversation.hasMessages) {
      setPendingDeleteConversation(conversation);
      return;
    }

    await performDeleteConversation(conversation);
  };

  const confirmDeleteConversation = () => {
    const conversation = pendingDeleteConversation;
    if (!conversation) return;
    setPendingDeleteConversation(null);
    void performDeleteConversation(conversation);
  };

  return (
    <aside
      aria-label="Conversation history"
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
          aria-label="Resize history panel"
          className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize z-10 hover:bg-foreground/20 active:bg-foreground/30 transition-colors"
        />
      )}
      {displayCollapsed ? (
        <TooltipFor label="Expand history" side="left">
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="m-1 h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring flex items-center justify-center"
            aria-label="Expand history panel"
          >
            <ChevronLeft size={15} />
          </button>
        </TooltipFor>
      ) : (
        <>
          <div className="h-10 border-b border-border px-3 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <TooltipFor label="Collapse history">
                <button
                  type="button"
                  onClick={() => setCollapsed(true)}
                  className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring flex items-center justify-center"
                  aria-label="Collapse history panel"
                >
                  <ChevronRight size={15} />
                </button>
              </TooltipFor>
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                History
              </span>
            </div>
            <TooltipFor label="New conversation">
              <button
                type="button"
                disabled={!activeMindId || isActiveMindBusy || isCreatingConversation}
                onClick={() => { void startNewConversation(); }}
                className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring flex items-center justify-center disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                aria-label="New conversation"
              >
                <Plus size={15} />
              </button>
            </TooltipFor>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {!activeMindId ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">Select an agent to see history</p>
            ) : isHistoryLoading ? (
              showHistorySkeleton ? <HistorySkeleton /> : null
            ) : visibleConversations.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">No conversations yet</p>
            ) : null}
            {selectedConversationError ? (
              <p role="alert" className="mb-2 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-2 text-xs text-destructive">
                {selectedConversationError}
              </p>
            ) : null}
            {groupByRecency(visibleConversations).map((group) => (
              <section key={group.bucket} className="mb-3 last:mb-0">
                <h3 className="px-2 pb-1 pt-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {BUCKET_LABEL[group.bucket]}
                </h3>
                {group.items.map((conversation) => {
                  const isSelected = conversation.sessionId === selectedConversationId || conversation.active;
                  const displayTitle = cleanTitle(conversation.title);

                  return (
                    <div
                      key={conversation.sessionId}
                      className={cn(
                        'group flex items-center gap-2 rounded-lg border-l-2 px-2 py-2 transition-colors',
                        isSelected
                          ? 'border-l-foreground bg-selected text-foreground'
                          : 'border-l-transparent text-muted-foreground hover:text-foreground hover:bg-hover'
                      )}
                    >
                      <button
                        type="button"
                        aria-label={`Resume ${displayTitle}`}
                        disabled={isActiveMindBusy}
                        onClick={() => { void resumeConversation(conversation.sessionId); }}
                        className="min-w-0 flex-1 text-left disabled:cursor-not-allowed"
                      >
                        {renamingId === conversation.sessionId ? (
                          <div className="space-y-1">
                            <input
                              ref={renameInputRef}
                              value={renameValue}
                              onChange={(event) => setRenameValue(event.target.value)}
                              onKeyDown={(event) => handleRenameKeyDown(event, conversation.sessionId)}
                              onBlur={() => { void completeRename(conversation.sessionId, renameValue.trim() || null); }}
                              className="w-full rounded border border-primary bg-background px-1.5 py-0.5 text-sm text-foreground outline-none"
                            />
                            <p className="text-[10px] text-muted-foreground/80">
                              <kbd className="rounded border border-border bg-muted px-1 py-0.5 text-[9px] font-mono">↵</kbd> save · <kbd className="rounded border border-border bg-muted px-1 py-0.5 text-[9px] font-mono">esc</kbd> cancel
                            </p>
                          </div>
                        ) : (
                          <>
                            <div className="truncate text-sm font-medium">{displayTitle}</div>
                            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                              <span>{formatRelativeTime(conversation.updatedAt)}</span>
                              {conversation.active ? (
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
                            onClick={() => startRename(conversation)}
                            disabled={isActiveMindBusy || deletingId === conversation.sessionId}
                            className="h-7 w-7 rounded-md text-muted-foreground opacity-40 hover:text-foreground hover:bg-accent hover:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring flex items-center justify-center disabled:cursor-not-allowed disabled:opacity-30"
                            aria-label={`Rename ${displayTitle}`}
                          >
                            <Pencil size={13} />
                          </button>
                        </TooltipFor>
                        <TooltipFor label="Delete">
                          <button
                            type="button"
                            onClick={() => { void deleteConversation(conversation); }}
                            disabled={isActiveMindBusy || deletingId !== null}
                            className="h-7 w-7 rounded-md text-muted-foreground opacity-40 hover:text-destructive hover:bg-destructive/10 hover:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring flex items-center justify-center disabled:cursor-not-allowed disabled:opacity-30"
                            aria-label={`Delete ${displayTitle}`}
                          >
                            <Trash2 size={13} />
                          </button>
                        </TooltipFor>
                      </div>
                    </div>
                  );
                })}
              </section>
            ))}
          </div>
        </>
      )}
      <Dialog open={pendingDeleteConversation !== null} onOpenChange={(open) => {
        if (!open && !deletingId) setPendingDeleteConversation(null);
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete "{pendingDeleteConversation?.title}"?</DialogTitle>
            <DialogDescription>
              This conversation cannot be restored after it is deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setPendingDeleteConversation(null)}
              disabled={deletingId !== null}
              className="rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmDeleteConversation}
              disabled={deletingId !== null}
              className="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
            >
              Delete conversation
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}

// Drop the absolute timestamp baked into auto-generated titles like
// `New chat · 6/3/2026, 9:39:42 AM`. Until the first user prompt summarizes
// the thread, the row badge already shows the relative time -- showing the
// same instant twice in two formats is noisy.
function cleanTitle(title: string): string {
  // Match "New chat · <anything>" and trim the timestamp tail.
  if (/^New chat\s*[·:]/i.test(title)) return 'New chat';
  return title;
}

type ConversationBucket = 'today' | 'yesterday' | 'older';

const BUCKET_LABEL: Record<ConversationBucket, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  older: 'Older',
};

function bucketFor(timestamp: number, now: Date = new Date()): ConversationBucket {
  const d = new Date(timestamp);
  const sameDay = d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
  if (sameDay) return 'today';

  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const wasYesterday = d.getFullYear() === yesterday.getFullYear()
    && d.getMonth() === yesterday.getMonth()
    && d.getDate() === yesterday.getDate();
  if (wasYesterday) return 'yesterday';

  return 'older';
}

// Group an already-sorted (newest-first) conversation list into recency
// buckets while preserving order within each bucket.
function groupByRecency(
  conversations: ConversationSummary[],
  now: Date = new Date(),
): Array<{ bucket: ConversationBucket; items: ConversationSummary[] }> {
  const groups: Array<{ bucket: ConversationBucket; items: ConversationSummary[] }> = [];
  for (const c of conversations) {
    const ts = Date.parse(c.updatedAt);
    if (Number.isNaN(ts)) continue;
    const b = bucketFor(ts, now);
    const last = groups[groups.length - 1];
    if (last && last.bucket === b) {
      last.items.push(c);
    } else {
      groups.push({ bucket: b, items: [c] });
    }
  }
  return groups;
}
