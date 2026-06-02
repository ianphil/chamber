import { ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { getErrorMessage } from '@chamber/shared/getErrorMessage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ConversationSummary } from '@chamber/shared/types';
import { useAppDispatch, useAppState } from '../../lib/store';
import { Logger } from '../../lib/logger';
import { cn } from '../../lib/utils';
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
        'shrink-0 bg-card border border-border rounded-xl overflow-hidden flex flex-col transition-[width]',
        isCollapsed ? 'w-10' : 'w-80',
      )}
    >
      {isCollapsed ? (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="m-1 h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 flex items-center justify-center"
          aria-label="Expand history panel"
        >
          <ChevronLeft size={15} />
        </button>
      ) : (
        <>
          <div className="h-10 border-b border-border px-3 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setCollapsed(true)}
                className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 flex items-center justify-center"
                aria-label="Collapse history panel"
              >
                <ChevronRight size={15} />
              </button>
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                History
              </span>
            </div>
            <button
              type="button"
              disabled={!activeMindId || isActiveMindBusy || isCreatingConversation}
              onClick={() => { void startNewConversation(); }}
              className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 flex items-center justify-center disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
              aria-label="New conversation"
            >
              <Plus size={15} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {!activeMindId ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">Select an agent to see history</p>
            ) : isHistoryLoading ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">Loading history...</p>
            ) : visibleConversations.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">No conversations yet</p>
            ) : null}
            {selectedConversationError ? (
              <p role="alert" className="mb-2 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-2 text-xs text-destructive">
                {selectedConversationError}
              </p>
            ) : null}
            {visibleConversations.map((conversation) => {
              const isSelected = conversation.sessionId === selectedConversationId || conversation.active;

              return (
                <div
                  key={conversation.sessionId}
                  className={cn(
                    'group flex items-center gap-2 rounded-lg border-l-2 px-2 py-2 transition-colors',
                    isSelected
                      ? 'border-l-primary bg-accent text-foreground'
                      : 'border-l-transparent text-muted-foreground hover:text-foreground hover:bg-accent/50'
                  )}
                >
                  <button
                    type="button"
                    aria-label={`Resume ${conversation.title}`}
                    disabled={isActiveMindBusy}
                    onClick={() => { void resumeConversation(conversation.sessionId); }}
                    className="min-w-0 flex-1 text-left disabled:cursor-not-allowed"
                  >
                    {renamingId === conversation.sessionId ? (
                      <input
                        ref={renameInputRef}
                        value={renameValue}
                        onChange={(event) => setRenameValue(event.target.value)}
                        onKeyDown={(event) => handleRenameKeyDown(event, conversation.sessionId)}
                        onBlur={() => { void completeRename(conversation.sessionId, renameValue.trim() || null); }}
                        className="w-full rounded border border-primary bg-background px-1.5 py-0.5 text-sm text-foreground outline-none"
                      />
                    ) : (
                      <>
                        <div className="truncate text-sm font-medium">{conversation.title}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {formatRelativeTime(conversation.updatedAt)}
                          {conversation.active ? ' · Active' : ''}
                        </div>
                      </>
                    )}
                  </button>

                  <div className="flex items-center">
                    <button
                      type="button"
                      onClick={() => startRename(conversation)}
                      disabled={isActiveMindBusy || deletingId === conversation.sessionId}
                      className="h-7 w-7 rounded-md text-muted-foreground opacity-0 hover:text-foreground hover:bg-accent group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 flex items-center justify-center disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label={`Rename ${conversation.title}`}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => { void deleteConversation(conversation); }}
                      disabled={isActiveMindBusy || deletingId !== null}
                      className="h-7 w-7 rounded-md text-muted-foreground opacity-0 hover:text-destructive hover:bg-destructive/10 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 flex items-center justify-center disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label={`Delete ${conversation.title}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
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
              className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50"
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

function formatRelativeTime(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
