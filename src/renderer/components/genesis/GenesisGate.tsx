import React, { useState } from 'react';
import { useAppState, useAppDispatch } from '../../lib/store';
import { LandingScreen } from './LandingScreen';
import { GenesisFlow } from './GenesisFlow';

interface Props {
  children: React.ReactNode;
}

export function GenesisGate({ children }: Props) {
  const { agentStatus, showLanding } = useAppState();
  const dispatch = useAppDispatch();
  const [mode, setMode] = useState<'idle' | 'genesis'>('idle');

  const showGate = showLanding || !agentStatus.connected;

  // If in genesis flow, show it
  if (mode === 'genesis') {
    return <GenesisFlow onComplete={() => {
      setMode('idle');
      dispatch({ type: 'HIDE_LANDING' });
    }} />;
  }

  // Show landing if triggered or no mind connected
  if (showGate) {
    return (
      <LandingScreen
        onNewAgent={() => setMode('genesis')}
        onOpenExisting={async () => {
          const path = await window.electronAPI.agent.selectMindDirectory();
          if (path) {
            const status = await window.electronAPI.agent.getStatus();
            dispatch({ type: 'SET_AGENT_STATUS', payload: status });
            dispatch({ type: 'HIDE_LANDING' });
          }
        }}
      />
    );
  }

  return <>{children}</>;
}
