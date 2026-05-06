import { MoreHorizontal, Pencil, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ConversationSummary } from '@chamber/shared/types';
import { useAppDispatch, useAppState } from '../../lib/store';
import { Logger } from '../../lib/logger';
import { cn } from '../../lib/utils';

const log = Logger.create('ConversationHistoryPanel');

export function ConversationHistoryPanel() {
  const { activeMindId, conversationHistoryByMind, activeConversationByMind, messagesByMind, streamingByMind } = useAppState();
  const dispatch = useAppDispatch();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  const conversations = useMemo(() => {
    if (!activeMindId) return [];
    return conversationHistoryByMind[activeMindId] ?? [];
  }, [activeMindId, conversationHistoryByMind]);
  const selectedConversationId = activeMindId ? activeConversationByMind[activeMindId] : undefined;
  const activeMessageCount = activeMindId ? (messagesByMind[activeMindId]?.length ?? 0) : 0;
  const isActiveMindStreaming = activeMindId ? Boolean(streamingByMind[activeMindId]) : false;

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

  useEffect(() => {
    if (!activeMindId) return;
    let cancelled = false;
    window.electronAPI.conversationHistory.list(activeMindId).then((history) => {
      if (cancelled) return;
      dispatch({ type: 'SET_CONVERSATION_HISTORY', payload: { mindId: activeMindId, conversations: history } });
      const activeConversation = history.find((conversation) => conversation.active);
      if (activeConversation && activeMessageCount === 0 && !isActiveMindStreaming) {
        window.electronAPI.conversationHistory.resume(activeMindId, activeConversation.sessionId).then((result) => {
          if (cancelled) return;
          applyResumeResult(activeMindId, result);
        }).catch((error: unknown) => {
          log.warn('Failed to hydrate active conversation:', error);
        });
      }
    }).catch((error: unknown) => {
      log.warn('Failed to load conversation history:', error);
    });
    return () => {
      cancelled = true;
    };
  }, [activeMessageCount, activeMindId, applyResumeResult, dispatch, isActiveMindStreaming]);

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
    if (!activeMindId || isActiveMindStreaming || (sessionId === selectedConversationId && activeMessageCount > 0)) return;
    const result = await window.electronAPI.conversationHistory.resume(activeMindId, sessionId);
    applyResumeResult(activeMindId, result);
    dispatch({ type: 'SET_ACTIVE_VIEW', payload: 'chat' });
  };

  const startNewConversation = async () => {
    if (!activeMindId || isActiveMindStreaming) return;
    const result = await window.electronAPI.chat.newConversation(activeMindId);
    await window.electronAPI.chatroom.clear();
    dispatch({ type: 'NEW_CONVERSATION' });
    applyResumeResult(activeMindId, result);
    dispatch({ type: 'SET_ACTIVE_VIEW', payload: 'chat' });
  };

  return (
    <aside aria-label="Conversation history" className="w-80 shrink-0 bg-card border border-border rounded-xl overflow-hidden flex flex-col">
      <div className="h-10 border-b border-border px-3 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          History
        </span>
        <button
          type="button"
          disabled={!activeMindId || isActiveMindStreaming}
          onClick={() => { void startNewConversation(); }}
          className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 flex items-center justify-center disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
          aria-label="New conversation"
        >
          <Plus size={15} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {conversations.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">No conversations yet</p>
        ) : null}
        {conversations.map((conversation) => {
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
                disabled={isActiveMindStreaming}
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
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
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
                  className="h-7 w-7 rounded-md text-muted-foreground opacity-0 hover:text-foreground hover:bg-accent group-hover:opacity-100 flex items-center justify-center"
                  aria-label={`Rename ${conversation.title}`}
                >
                  <Pencil size={13} />
                </button>
                <button
                  type="button"
                  className="h-7 w-7 rounded-md text-muted-foreground opacity-0 hover:text-foreground hover:bg-accent group-hover:opacity-100 flex items-center justify-center"
                  aria-label={`${conversation.title} options`}
                >
                  <MoreHorizontal size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
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
