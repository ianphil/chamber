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

  // Chat event listener — must stay alive regardless of active view
  useEffect(() => {
    const unsub = window.electronAPI.chat.onEvent((mindId, messageId, event) => {
      dispatch({ type: 'CHAT_EVENT', payload: { mindId, messageId, event } });
    });
    return () => { unsub(); };
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
      void window.electronAPI.mind.setActive(payload.targetMindId).catch((err: unknown) => {
        log.error('Failed to activate A2A target mind:', err);
      });
      dispatch({ type: 'A2A_INCOMING', payload });
    });
    return () => { unsub(); };
  }, [dispatch]);

  useEffect(() => {
    const unsub = window.electronAPI.a2a.onOutgoing((payload) => {
      dispatch({ type: 'A2A_OUTGOING', payload });
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
