import React, { useState } from 'react';
import { useAppState, useAppDispatch } from '../../lib/store';
import { LandingScreen } from './LandingScreen';
import { GenesisFlow } from './GenesisFlow';

interface Props {
  children: React.ReactNode;
}

export function GenesisGate({ children }: Props) {
  const { agentStatus, minds, showLanding } = useAppState();
  const dispatch = useAppDispatch();
  const [mode, setMode] = useState<'idle' | 'genesis'>('idle');

  const hasMinds = minds.length > 0 || agentStatus.connected;
  const showGate = showLanding || !hasMinds;

  // If in genesis flow, show it
  if (mode === 'genesis') {
    return <GenesisFlow onComplete={() => {
      setMode('idle');
      dispatch({ type: 'HIDE_LANDING' });
    }} />;
  }

  // Show landing if triggered or no minds loaded
  if (showGate) {
    return (
      <LandingScreen
        onNewAgent={() => setMode('genesis')}
        onOpenExisting={async () => {
          const path = await window.electronAPI.agent.selectMindDirectory();
          if (path) {
            // Refresh minds list
            const loadedMinds = await window.electronAPI.mind.list();
            dispatch({ type: 'SET_MINDS', payload: loadedMinds });
            if (loadedMinds.length > 0) {
              dispatch({ type: 'SET_ACTIVE_MIND', payload: loadedMinds[loadedMinds.length - 1].mindId });
            }
            dispatch({ type: 'HIDE_LANDING' });
          }
        }}
      />
    );
  }

  return <>{children}</>;
}
