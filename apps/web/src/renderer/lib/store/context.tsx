import React, { createContext, useContext, useEffect, useReducer, type Dispatch } from 'react';
import type { AppState, AppAction } from './state';
import { initialState } from './state';
import { appReducer } from './reducer';
import { CHAT_STATE_STORAGE_KEY, parsePersistedChatState, serializeChatState } from './chatStatePersistence';

const AppStateContext = createContext<AppState>(initialState);
const AppDispatchContext = createContext<Dispatch<AppAction>>(() => { /* noop */ });

export function AppStateProvider({ children, testInitialState }: { children: React.ReactNode; testInitialState?: Partial<AppState> }) {
  const [state, dispatch] = useReducer(appReducer, undefined, () => {
    const baseState = testInitialState ? { ...initialState, ...testInitialState } : initialState;
    const persisted = testInitialState ? null : parsePersistedChatState(localStorage.getItem(CHAT_STATE_STORAGE_KEY));
    return persisted ? { ...baseState, ...persisted } : baseState;
  });

  useEffect(() => {
    if (testInitialState) return;
    localStorage.setItem(CHAT_STATE_STORAGE_KEY, serializeChatState({
      messagesByMind: state.messagesByMind,
      streamingByMind: state.streamingByMind,
    }));
  }, [state.messagesByMind, state.streamingByMind, testInitialState]);

  useEffect(() => {
    if (testInitialState) return;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== CHAT_STATE_STORAGE_KEY) return;
      const persisted = parsePersistedChatState(event.newValue);
      if (!persisted) return;
      dispatch({ type: 'HYDRATE_CHAT_STATE', payload: persisted });
    };

    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [testInitialState]);

  return (
    <AppStateContext.Provider value={state}>
      <AppDispatchContext.Provider value={dispatch}>
        {children}
      </AppDispatchContext.Provider>
    </AppStateContext.Provider>
  );
}

export function useAppState() {
  return useContext(AppStateContext);
}

export function useAppDispatch() {
  return useContext(AppDispatchContext);
}
