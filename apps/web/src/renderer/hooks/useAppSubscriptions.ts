import { useEffect, useRef } from 'react';
import { useAppState, useAppDispatch } from '../lib/store';
import { Logger } from '../lib/logger';

const log = Logger.create('AppSubscriptions');

/**
 * App-level subscriptions that must survive view switches.
 * Mount once in AppShell — never in a view component.
 */
export function useAppSubscriptions() {
  const { minds, activeMindId } = useAppState();
  const dispatch = useAppDispatch();
  const viewsLoaded = useRef(false);
  const lastChatEventSequence = useRef(0);
  const seenChatEventSequences = useRef(new Set<number>());

  // Feature flags are app-owned, not user-configurable renderer state.
  useEffect(() => {
    let cancelled = false;
    const loadFeatureFlags = async () => {
      try {
        const featureFlags = await window.electronAPI.app.getFeatureFlags();
        if (!cancelled) dispatch({ type: 'SET_FEATURE_FLAGS', payload: featureFlags });
      } catch (err) {
        log.error('Failed to load feature flags:', err);
      }
    };
    loadFeatureFlags();
    return () => {
      cancelled = true;
    };
  }, [dispatch]);

  // Chat event listener — must stay alive regardless of active view
  useEffect(() => {
    let cancelled = false;

    const markChatEventSequenceSeen = (sequence: number) => {
      seenChatEventSequences.current.add(sequence);
      lastChatEventSequence.current = Math.max(lastChatEventSequence.current, sequence);
      if (seenChatEventSequences.current.size > 1_000) {
        const floor = lastChatEventSequence.current - 1_000;
        for (const seen of seenChatEventSequences.current) {
          if (seen < floor) seenChatEventSequences.current.delete(seen);
        }
      }
    };

    const applyMissedEvents = async () => {
      try {
        const missed = await window.electronAPI.chat.replayEvents(lastChatEventSequence.current);
        if (cancelled) return;
        const terminalMindIds = new Set<string>();
        for (const entry of missed) {
          if (seenChatEventSequences.current.has(entry.sequence)) continue;
          markChatEventSequenceSeen(entry.sequence);
          dispatch({
            type: 'CHAT_EVENT',
            payload: { mindId: entry.mindId, messageId: entry.messageId, event: entry.event },
          });
          if (isTerminalChatEvent(entry.event.type)) {
            terminalMindIds.add(entry.mindId);
          }
        }
        for (const mindId of terminalMindIds) {
          void refreshConversationHistory(mindId);
        }
      } catch (err) {
        log.error('Failed to replay missed chat events:', err);
      }
    };

    const refreshConversationHistory = async (mindId: string) => {
      try {
        const conversations = await window.electronAPI.conversationHistory.list(mindId);
        if (!cancelled) {
          dispatch({ type: 'SET_CONVERSATION_HISTORY', payload: { mindId, conversations } });
        }
      } catch (err) {
        log.warn('Failed to refresh conversation history after chat event:', err);
      }
    };

    void window.electronAPI.chat.getEventSequence()
      .then((sequence) => {
        if (!cancelled) {
          lastChatEventSequence.current = Math.max(lastChatEventSequence.current, sequence);
        }
      })
      .catch((err) => {
        log.error('Failed to initialize chat event replay cursor:', err);
      });

    const unsub = window.electronAPI.chat.onEvent((mindId, messageId, event, sequence) => {
      if (typeof sequence === 'number') {
        if (seenChatEventSequences.current.has(sequence)) return;
        markChatEventSequenceSeen(sequence);
      }
      dispatch({ type: 'CHAT_EVENT', payload: { mindId, messageId, event } });
      if (isTerminalChatEvent(event.type)) {
        void refreshConversationHistory(mindId);
      }
    });

    const onFocus = () => { void applyMissedEvents(); };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void applyMissedEvents();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      unsub();
    };
  }, [dispatch]);

  // Listen for view discovery changes (file watcher)
  useEffect(() => {
    const unsub = window.electronAPI.lens.onViewsChanged((views, mindId) => {
      if (mindId && mindId !== activeMindId) return;
      dispatch({ type: 'SET_DISCOVERED_VIEWS', payload: views });
    });
    return () => { unsub(); };
  }, [activeMindId, dispatch]);

  // Reload views when active mind changes
  useEffect(() => {
    viewsLoaded.current = false;
  }, [activeMindId]);

  // Fetch models whenever active mind changes. The IPC call is uncached
  // here, but the @github/copilot CLI server caches its `/models` response
  // in-memory for 30 minutes per CLI subprocess — so this returns the same
  // list across mind switches until either the CLI restarts or the TTL
  // expires. See docs/model-cache-investigation.md (issue #90).
  useEffect(() => {
    const connected = minds.length > 0 || !!activeMindId;
    if (!connected) return;

    const loadModels = async () => {
      try {
        const models = await window.electronAPI.chat.listModels(activeMindId ?? undefined);
        dispatch({ type: 'SET_AVAILABLE_MODELS', payload: models });
      } catch (err) {
        log.error('Failed to load models:', err);
      }
    };
    loadModels();

    // Re-fetch the model list whenever the BYO LLM config changes so
    // BYO models appear/disappear without forcing cloud-selected minds
    // onto the custom provider.
    const unsub = window.electronAPI.byoLlm.onChanged(() => { void loadModels(); });
    return () => { unsub(); };
  }, [minds.length, activeMindId, dispatch]);

  // Fetch discovered Lens views
  useEffect(() => {
    if (!activeMindId) {
      viewsLoaded.current = false;
      return;
    }

    if (!viewsLoaded.current) {
      let cancelled = false;
      const loadViews = async () => {
        try {
          const views = await window.electronAPI.lens.getViews(activeMindId);
          if (cancelled) return;
          dispatch({ type: 'SET_DISCOVERED_VIEWS', payload: views });
          viewsLoaded.current = true;
        } catch (err) {
          log.error('Failed to load views:', err);
        }
      };
      loadViews();
      return () => {
        cancelled = true;
      };
    }
  }, [minds.length, activeMindId, dispatch]);

  // A2A incoming message listener
  useEffect(() => {
    const unsub = window.electronAPI.a2a.onIncoming((payload) => {
      dispatch({ type: 'A2A_INCOMING', payload });
    });
    return () => { unsub(); };
  }, [dispatch]);

  // A2A task status update listener
  useEffect(() => {
    const unsub = window.electronAPI.a2a.onTaskStatusUpdate((payload) => {
      dispatch({ type: 'TASK_STATUS_UPDATE', payload });
    });
    return () => { unsub(); };
  }, [dispatch]);

  // A2A task artifact update listener
  useEffect(() => {
    const unsub = window.electronAPI.a2a.onTaskArtifactUpdate((payload) => {
      dispatch({ type: 'TASK_ARTIFACT_UPDATE', payload });
    });
    return () => { unsub(); };
  }, [dispatch]);
}

function isTerminalChatEvent(type: string): boolean {
  return type === 'done' || type === 'error' || type === 'timeout';
}
