import { useEffect, useCallback } from 'react';
import { useAppState, useAppDispatch } from '../lib/store';
import { selectPreferredMind } from '../lib/mindSelection';

export function useAgentStatus() {
  const { minds } = useAppState();
  const dispatch = useAppDispatch();

  useEffect(() => {
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
    const unsubSwitchStarted = window.electronAPI.auth.onAccountSwitchStarted(({ login }) => {
      dispatch({ type: 'ACCOUNT_SWITCH_STARTED', payload: { login } });
    });
    const unsubSwitched = window.electronAPI.auth.onAccountSwitched(() => {
      dispatch({ type: 'ACCOUNT_SWITCH_COMPLETED' });
    });
    const unsubLoggedOut = window.electronAPI.auth.onLoggedOut(() => {
      dispatch({ type: 'LOGGED_OUT' });
    });

    return () => {
      unsubMinds();
      unsubSwitchStarted();
      unsubSwitched();
      unsubLoggedOut();
    };
  }, [dispatch]);

  const selectMindDirectory = useCallback(async () => {
    const dirPath = await window.electronAPI.mind.selectDirectory();
    if (dirPath) {
      const openedMind = await window.electronAPI.mind.add(dirPath);
      const loadedMinds = await window.electronAPI.mind.list();
      dispatch({ type: 'SET_MINDS', payload: loadedMinds });
      const mindToSelect = selectPreferredMind(loadedMinds, openedMind);
      if (mindToSelect) dispatch({ type: 'SET_ACTIVE_MIND', payload: mindToSelect.mindId });
    }
    return dirPath;
  }, [dispatch]);

  return { minds, selectMindDirectory };
}
