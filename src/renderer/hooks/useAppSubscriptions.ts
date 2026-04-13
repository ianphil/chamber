import { useEffect, useRef } from 'react';
import { useAppState, useAppDispatch } from '../lib/store';

/**
 * App-level subscriptions that must survive view switches.
 * Mount once in AppShell — never in a view component.
 */
export function useAppSubscriptions() {
  const { agentStatus, activeMindId } = useAppState();
  const dispatch = useAppDispatch();
  const modelsLoaded = useRef(false);
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
    const unsub = window.electronAPI.lens.onViewsChanged((views) => {
      dispatch({ type: 'SET_DISCOVERED_VIEWS', payload: views });
    });
    return () => { unsub(); };
  }, [dispatch]);

  // Reload views and models when active mind changes
  useEffect(() => {
    modelsLoaded.current = false;
    viewsLoaded.current = false;
  }, [activeMindId]);
  useEffect(() => {
    const connected = agentStatus.connected || !!activeMindId;
    if (!connected) {
      modelsLoaded.current = false;
      viewsLoaded.current = false;
      return;
    }

    if (!modelsLoaded.current) {
      const loadModels = async () => {
        try {
          const models = await window.electronAPI.chat.listModels();
          dispatch({ type: 'SET_AVAILABLE_MODELS', payload: models });
          modelsLoaded.current = true;

          const persisted = localStorage.getItem('chamber:selectedModel');
          const valid = persisted && models.some(m => m.id === persisted);
          if (!valid && models.length > 0) {
            dispatch({ type: 'SET_SELECTED_MODEL', payload: models[0].id });
          }
        } catch (err) {
          console.error('Failed to load models:', err);
        }
      };
      loadModels();
    }

    // Fetch discovered Lens views
    if (!viewsLoaded.current) {
      const loadViews = async () => {
        try {
          const views = await window.electronAPI.lens.getViews();
          dispatch({ type: 'SET_DISCOVERED_VIEWS', payload: views });
          viewsLoaded.current = true;
        } catch (err) {
          console.error('Failed to load views:', err);
        }
      };
      loadViews();
    }
  }, [agentStatus.connected, activeMindId, dispatch]);

  // A2A incoming message listener
  useEffect(() => {
    const unsub = window.electronAPI.a2a.onIncoming((payload) => {
      dispatch({ type: 'A2A_INCOMING', payload });
    });
    return () => { unsub(); };
  }, [dispatch]);
}
