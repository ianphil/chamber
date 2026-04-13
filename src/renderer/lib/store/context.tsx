import React, { createContext, useContext, useReducer, type Dispatch } from 'react';
import type { AppState, AppAction } from './state';
import { initialState } from './state';
import { appReducer } from './reducer';

const AppStateContext = createContext<AppState>(initialState);
const AppDispatchContext = createContext<Dispatch<AppAction>>(() => {});

export function AppStateProvider({ children, testInitialState }: { children: React.ReactNode; testInitialState?: Partial<AppState> }) {
  const [state, dispatch] = useReducer(appReducer, testInitialState ? { ...initialState, ...testInitialState } : initialState);

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
