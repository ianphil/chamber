import React, { createContext, useContext, useEffect, useReducer, useRef, type Dispatch } from 'react';
import type { AppState, AppAction } from './state';
import { initialState } from './state';
import { appReducer } from './reducer';
import { CHAT_STATE_CHANNEL, createChatStateSyncMessage, parseChatStateSyncMessage } from './chatStateSync';
import type { ChatStateSyncMessage } from './chatStateSync';

const AppStateContext = createContext<AppState>(initialState);
const AppDispatchContext = createContext<Dispatch<AppAction>>(() => { /* noop */ });

export function AppStateProvider({ children, testInitialState }: { children: React.ReactNode; testInitialState?: Partial<AppState> }) {
  const [state, dispatch] = useReducer(appReducer, testInitialState ? { ...initialState, ...testInitialState } : initialState);
  const stateRef = useRef(state);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const applyingRemoteState = useRef(false);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (testInitialState || !channelRef.current) return;
    if (applyingRemoteState.current) {
      applyingRemoteState.current = false;
      return;
    }
    channelRef.current.postMessage(createChatStateSyncMessage({
      messagesByMind: state.messagesByMind,
      streamingByMind: state.streamingByMind,
    }));
  }, [state.messagesByMind, state.streamingByMind, testInitialState]);

  useEffect(() => {
    if (testInitialState || typeof BroadcastChannel === 'undefined') return;

    const channel = new BroadcastChannel(CHAT_STATE_CHANNEL);
    channelRef.current = channel;
    channel.onmessage = (event) => {
      const message = parseChatStateSyncMessage(event.data);
      if (!message) return;

      if (message.type === 'request-state') {
        channel.postMessage(createChatStateSyncMessage({
          messagesByMind: stateRef.current.messagesByMind,
          streamingByMind: stateRef.current.streamingByMind,
        }));
        return;
      }

      applyingRemoteState.current = true;
      dispatch({ type: 'HYDRATE_CHAT_STATE', payload: message.payload });
    };

    channel.postMessage({ type: 'request-state' } satisfies ChatStateSyncMessage);

    return () => {
      channelRef.current = null;
      channel.close();
    };
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
