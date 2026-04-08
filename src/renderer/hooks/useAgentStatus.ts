import { useEffect, useCallback } from 'react';
import { useAppState, useAppDispatch } from '../lib/store';

export function useAgentStatus() {
  const { agentStatus } = useAppState();
  const dispatch = useAppDispatch();

  useEffect(() => {
    // Load initial status
    window.electronAPI.agent.getStatus().then((status) => {
      dispatch({ type: 'SET_AGENT_STATUS', payload: status });
    });

    const unsub = window.electronAPI.agent.onStatusChanged((status) => {
      dispatch({ type: 'SET_AGENT_STATUS', payload: status });
    });

    return unsub;
  }, [dispatch]);

  const selectMindDirectory = useCallback(async () => {
    const path = await window.electronAPI.agent.selectMindDirectory();
    if (path) {
      const status = await window.electronAPI.agent.getStatus();
      dispatch({ type: 'SET_AGENT_STATUS', payload: status });
    }
    return path;
  }, [dispatch]);

  return { agentStatus, selectMindDirectory };
}
