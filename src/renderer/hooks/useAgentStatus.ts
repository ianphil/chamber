import { useEffect, useCallback } from 'react';
import { useAppState, useAppDispatch } from '../lib/store';

export function useAgentStatus() {
  const { agentStatus, minds } = useAppState();
  const dispatch = useAppDispatch();

  useEffect(() => {
    // Load initial agent status (backward compat)
    window.electronAPI.agent.getStatus().then((status) => {
      dispatch({ type: 'SET_AGENT_STATUS', payload: status });
    });

    const unsub = window.electronAPI.agent.onStatusChanged((status) => {
      dispatch({ type: 'SET_AGENT_STATUS', payload: status });
    });

    // Load minds from MindManager
    window.electronAPI.mind.list().then((loadedMinds) => {
      if (loadedMinds.length > 0) {
        dispatch({ type: 'SET_MINDS', payload: loadedMinds });
        dispatch({ type: 'SET_ACTIVE_MIND', payload: loadedMinds[0].mindId });
      }
      dispatch({ type: 'MINDS_CHECKED' });
    });

    // Subscribe to mind changes
    const unsubMinds = window.electronAPI.mind.onMindChanged((updatedMinds) => {
      dispatch({ type: 'SET_MINDS', payload: updatedMinds });
    });

    return () => {
      unsub();
      unsubMinds();
    };
  }, [dispatch]);

  const selectMindDirectory = useCallback(async () => {
    const path = await window.electronAPI.agent.selectMindDirectory();
    if (path) {
      // Refresh minds list after adding
      const loadedMinds = await window.electronAPI.mind.list();
      dispatch({ type: 'SET_MINDS', payload: loadedMinds });
      if (loadedMinds.length > 0) {
        const newest = loadedMinds[loadedMinds.length - 1];
        dispatch({ type: 'SET_ACTIVE_MIND', payload: newest.mindId });
      }
      const status = await window.electronAPI.agent.getStatus();
      dispatch({ type: 'SET_AGENT_STATUS', payload: status });
    }
    return path;
  }, [dispatch]);

  return { agentStatus, minds, selectMindDirectory };
}
