import { useCallback, useEffect, useState } from 'react';
import { RotateCcw, Plus, Users } from 'lucide-react';
import { useAppState, useAppDispatch } from '../../lib/store';
import { ChatInput } from '../chat/ChatInput';
import { OrchestrationPicker } from './OrchestrationPicker';
import { OrchestrationDiagram } from './OrchestrationDiagram';
import { TaskLedgerPanel } from './TaskLedgerPanel';
import { useMindProfiles } from '../../hooks/useMindProfiles';
import { useUserProfile } from '../../hooks/useUserProfile';
import { useDelayedFlag } from '../../hooks/useDelayedFlag';
import { ParticipantBar } from './ParticipantBar';
import { ChatroomMessageList } from './ChatroomMessageList';
import { MetricsSummaryCard } from './MetricsSummaryCard';
import { ChatroomHydratingSkeleton } from './ChatroomHydratingSkeleton';
import { ChatroomEmptyState } from './ChatroomEmptyState';
import { ChatroomSessionPicker } from './ChatroomSessionPicker';
import type { DemoScenario } from './chatroomScenarios';

// ---------------------------------------------------------------------------
// ChatroomPanel
// ---------------------------------------------------------------------------
export function ChatroomPanel() {
  const {
    chatroomMessages,
    minds,
    chatroomStreamingByMind,
    availableModels,
    selectedModel,
    chatroomOrchestration,
    chatroomGroupChatConfig,
    chatroomHandoffConfig,
    chatroomMagenticConfig,
    chatroomActiveSpeaker,
    chatroomTaskLedger,
    chatroomMetrics,
    chatroomDisabledMindIds,
    chatroomSessions,
    activeChatroomSessionId,
  } = useAppState();
  const dispatch = useAppDispatch();
  const profileByMindId = useMindProfiles(minds);
  const userProfile = useUserProfile();
  const isStreaming = Object.values(chatroomStreamingByMind).some(Boolean);
  const hasActiveSession = activeChatroomSessionId !== null;
  const activeSession = chatroomSessions.find((s) => s.sessionId === activeChatroomSessionId);
  const connected = minds.length > 0;

  // Composer draft (controlled). Lets scenario clicks stage a prompt for the
  // user to review and edit before sending, instead of auto-firing.
  const [draft, setDraft] = useState('');
  // True while the on-mount auto-resume is still in flight. Shows a skeleton
  // (instead of flashing the picker) so a resumed transcript doesn't pop in.
  // Mirrors the single-agent chat hydrating state.
  const [isResuming, setIsResuming] = useState(true);
  // Grace-gate the resuming skeleton so a fast auto-resume doesn't flash a pulse.
  const showResumingSkeleton = useDelayedFlag(isResuming);
  // Hold the entire panel (chrome + content + composer) behind a single
  // skeleton while we auto-resume a backend-active session that the renderer
  // doesn't know about yet. Without this the composer and orchestration chrome
  // render first and the resumed transcript pops in above them. Once a session
  // is active (or the resume settles to the picker) we render everything at
  // once so nothing lands piecemeal. Active sessions already in renderer state
  // (the common case, and every unit test) skip the skeleton entirely.
  const showResumeSkeleton = !hasActiveSession && isResuming;

  /**
   * Create a fresh chatroom session and resume it in one shot. Used by the
   * picker's "+ New chatroom" CTA and by starter cards, where the user has
   * actively committed to starting a new conversation. The session-header
   * and sidebar "+ New chatroom" affordances use `handleResetToPicker`
   * instead so we don't pile up empty drafts every time the user wants to
   * start over.
   */
  const handleCreateAndResume = useCallback(async (): Promise<string | null> => {
    try {
      const created = await window.electronAPI.chatroom.createSession();
      const resumed = await window.electronAPI.chatroom.resumeSession(created.sessionId);
      const sessions = await window.electronAPI.chatroom.listSessions();
      dispatch({ type: 'RESUME_CHATROOM_SESSION', payload: { ...resumed, sessions } });
      return created.sessionId;
    } catch {
      return null;
    }
  }, [dispatch]);

  /**
   * Reset back to the picker without creating a new session on disk. The
   * actual new session is created lazily on first Send (see handleSend).
   * This avoids the empty-session-spam problem where every header click
   * left an unused "New chatroom" entry in the sidebar.
   */
  const handleResetToPicker = useCallback(async () => {
    dispatch({ type: 'CLEAR_ACTIVE_CHATROOM_SESSION' });
    // Keep the sidebar list fresh in case the backend has changes.
    try {
      const sessions = await window.electronAPI.chatroom.listSessions();
      dispatch({ type: 'SET_CHATROOM_SESSIONS', payload: sessions });
    } catch {
      // Non-fatal.
    }
  }, [dispatch]);

  const handlePickPrompt = useCallback((prompt: string, mode: DemoScenario['mode']) => {
    // Stage the prompt into the composer; no session is created until the
    // user actually hits Send (handleSend does the lazy create). Also target
    // the scenario's orchestration mode so the room is pre-configured to run
    // the pattern the card demonstrates.
    setDraft(prompt);
    if (mode !== chatroomOrchestration) {
      dispatch({ type: 'SET_ORCHESTRATION', payload: mode });
      const config = mode === 'group-chat' ? chatroomGroupChatConfig
        : mode === 'handoff' ? chatroomHandoffConfig
        : mode === 'magentic' ? chatroomMagenticConfig
        : undefined;
      window.electronAPI.chatroom.setOrchestration(mode, config ?? undefined);
    }
  }, [dispatch, chatroomOrchestration, chatroomGroupChatConfig, chatroomHandoffConfig, chatroomMagenticConfig]);

  const handleClearChatroom = useCallback(async () => {
    if (isStreaming) return;
    await window.electronAPI.chatroom.clear();
    dispatch({ type: 'CHATROOM_CLEAR' });
  }, [dispatch, isStreaming]);

  // Load sessions and auto-resume the backend-active one on mount.
  //
  // ChatroomService restores its active pointer from disk at startup (and
  // legacy migration sets it for upgraders). On the renderer side we need
  // to match that so the panel doesn't open to the picker when the user
  // already has a session in progress.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sessions = await window.electronAPI.chatroom.listSessions();
        if (cancelled) return;
        dispatch({ type: 'SET_CHATROOM_SESSIONS', payload: sessions });
        const backendActive = sessions.find((s) => s.active);
        if (backendActive && backendActive.sessionId !== activeChatroomSessionId) {
          const resumed = await window.electronAPI.chatroom.resumeSession(backendActive.sessionId);
          if (cancelled) return;
          dispatch({ type: 'RESUME_CHATROOM_SESSION', payload: { ...resumed, sessions } });
        }
      } catch {
        // Non-fatal: leave the panel in its picker state.
      } finally {
        if (!cancelled) setIsResuming(false);
      }
    })();
    return () => { cancelled = true; };
    // Intentionally only run on mount; sidebar handles further refreshes.
  }, [dispatch]);

  // Subscribe to chatroom events
  useEffect(() => {
    const unsub = window.electronAPI.chatroom.onEvent((event) => {
      dispatch({ type: 'CHATROOM_EVENT', payload: event });
    });
    return unsub;
  }, [dispatch]);

  // Hydrate disabled-mind set on mount and stay in sync via the
  // authoritative state-changed channel (other windows can also toggle).
  // Subscribe FIRST, snapshot SECOND, and ignore the snapshot if the
  // authoritative channel has already published — otherwise a slow snapshot
  // can stomp a fresher state-changed event from another window.
  useEffect(() => {
    let cancelled = false;
    let receivedAuthoritativeUpdate = false;
    const unsub = window.electronAPI.chatroom.onStateChanged((state) => {
      if (cancelled) return;
      receivedAuthoritativeUpdate = true;
      dispatch({ type: 'SET_CHATROOM_DISABLED_MIND_IDS', payload: state.disabledMindIds });
    });
    window.electronAPI.chatroom.getDisabledMindIds().then((ids) => {
      if (cancelled || receivedAuthoritativeUpdate) return;
      dispatch({ type: 'SET_CHATROOM_DISABLED_MIND_IDS', payload: ids });
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [dispatch]);

  const handleToggleMind = useCallback((mindId: string, enabled: boolean) => {
    // Authoritative model: the click only invokes IPC; the state-changed
    // event from the service drives the visible state.
    void window.electronAPI.chatroom.setMindEnabled(mindId, enabled);
  }, []);

  const handleSend = useCallback(async (content: string) => {
    // Lazy session creation: if the user is in the picker (no active
    // session) and types straight into the composer, create + resume the
    // session right before sending so the picker doesn't leave behind a
    // pile of empty drafts.
    if (!activeChatroomSessionId) {
      const created = await handleCreateAndResume();
      if (!created) return;
    }
    const roundId = crypto.randomUUID();
    dispatch({
      type: 'CHATROOM_USER_MESSAGE',
      payload: {
        id: `user-${roundId}`,
        role: 'user',
        blocks: [{ type: 'text', content }],
        timestamp: Date.now(),
        sender: { mindId: 'user', name: 'You' },
        roundId,
      },
    });
    setDraft('');
    await window.electronAPI.chatroom.send(content, selectedModel ?? undefined, roundId);
  }, [activeChatroomSessionId, dispatch, handleCreateAndResume, selectedModel]);

  const handleStop = useCallback(async () => {
    await window.electronAPI.chatroom.stop();
  }, []);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {showResumeSkeleton ? (
        showResumingSkeleton ? <ChatroomHydratingSkeleton /> : null
      ) : (
        <>
      {hasActiveSession && activeSession ? (
        <div className="border-b border-border bg-card/40 px-4 py-2.5 shrink-0 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Users size={14} className="shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate text-sm font-semibold text-foreground" title={activeSession.title}>
              {activeSession.title}
            </span>
            <span className="shrink-0 rounded-md border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Chatroom
            </span>
            {minds.length < 2 ? (
              <span className="shrink-0 inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-200">
                Single agent - add more for multi-agent modes
              </span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => { void handleResetToPicker(); }}
            title="Start a new chatroom (created on first message)"
            aria-label="New chatroom"
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus size={12} aria-hidden />
            New chatroom
          </button>
        </div>
      ) : null}

      {minds.length > 0 ? (
        <>
          <ParticipantBar
            minds={minds}
            streamingByMind={chatroomStreamingByMind}
            disabledMindIds={chatroomDisabledMindIds}
            profileByMindId={profileByMindId}
            onToggle={handleToggleMind}
          />

          <OrchestrationPicker
            mode={chatroomOrchestration}
            groupChatConfig={chatroomGroupChatConfig}
            handoffConfig={chatroomHandoffConfig}
            magneticConfig={chatroomMagenticConfig}
            minds={minds}
            disabled={isStreaming}
            onModeChange={(mode) => {
              dispatch({ type: 'SET_ORCHESTRATION', payload: mode });
              const config = mode === 'group-chat' ? chatroomGroupChatConfig
                : mode === 'handoff' ? chatroomHandoffConfig
                : mode === 'magentic' ? chatroomMagenticConfig
                : undefined;
              window.electronAPI.chatroom.setOrchestration(mode, config ?? undefined);
            }}
            onGroupChatConfigChange={(config) => {
              dispatch({ type: 'SET_GROUP_CHAT_CONFIG', payload: config });
              window.electronAPI.chatroom.setOrchestration('group-chat', config);
            }}
            onHandoffConfigChange={(config) => {
              dispatch({ type: 'SET_HANDOFF_CONFIG', payload: config });
              window.electronAPI.chatroom.setOrchestration('handoff', config);
            }}
            onMagneticConfigChange={(config) => {
              dispatch({ type: 'SET_MAGENTIC_CONFIG', payload: config });
              window.electronAPI.chatroom.setOrchestration('magentic', config);
            }}
          />

          <OrchestrationDiagram
            mode={chatroomOrchestration}
            minds={minds}
            profileByMindId={profileByMindId}
            streamingByMind={chatroomStreamingByMind}
            activeSpeaker={chatroomActiveSpeaker}
            disabledMindIds={chatroomDisabledMindIds}
            groupChatConfig={chatroomGroupChatConfig}
            handoffConfig={chatroomHandoffConfig}
            magneticConfig={chatroomMagenticConfig}
            taskLedger={chatroomTaskLedger}
          />
        </>
      ) : null}

      {hasActiveSession ? (
        <>
          {chatroomTaskLedger.length > 0 && chatroomOrchestration === 'magentic' && (
            <TaskLedgerPanel
              ledger={chatroomTaskLedger}
              minds={minds}
              onRetry={(taskId) => {
                const task = chatroomTaskLedger.find((t) => t.id === taskId);
                if (task) {
                  handleSend(`Please retry the failed task: ${task.description}`);
                }
              }}
            />
          )}

          {chatroomMessages.length === 0 ? (
            <ChatroomEmptyState connected={connected} onPickPrompt={handlePickPrompt} />
          ) : (
            <>
              <ChatroomMessageList
                messages={chatroomMessages}
                minds={minds}
                profileByMindId={profileByMindId}
                userProfile={userProfile}
                moderatorMindId={chatroomOrchestration === 'group-chat' ? chatroomGroupChatConfig?.moderatorMindId : undefined}
                activeSpeaker={chatroomActiveSpeaker}
                orchestrationMode={chatroomOrchestration}
              />
              <div className="border-t border-border px-4 py-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { void handleClearChatroom(); }}
                  disabled={isStreaming}
                  title={isStreaming ? 'Stop streaming first' : 'Clear this chatroom and show the starter prompts again'}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <RotateCcw size={12} aria-hidden />
                  Show starter prompts
                </button>
              </div>
            </>
          )}

          {chatroomMetrics && !isStreaming && chatroomOrchestration === 'magentic' && (
            <MetricsSummaryCard metrics={chatroomMetrics} />
          )}
        </>
      ) : (
        <ChatroomSessionPicker
          hasSessions={chatroomSessions.length > 0}
          mindCount={minds.length}
          onPickPrompt={handlePickPrompt}
          onGoToChat={() => dispatch({ type: 'SET_ACTIVE_VIEW', payload: 'chat' })}
        />
      )}

      <ChatInput
        onSend={handleSend}
        onStop={handleStop}
        isStreaming={isStreaming}
        disabled={!connected || minds.length === 0}
        availableModels={availableModels}
        selectedModel={selectedModel}
        onModelChange={(model) => dispatch({ type: 'SET_SELECTED_MODEL', payload: model })}
        placeholder={hasActiveSession ? 'Message the chatroom…' : 'Type a message to start a new chatroom…'}
        value={draft}
        onValueChange={setDraft}
      />
        </>
      )}
    </div>
  );
}
