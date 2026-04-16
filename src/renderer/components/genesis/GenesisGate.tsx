import React, { useState } from 'react';
import { useAppState, useAppDispatch } from '../../lib/store';
import { LandingScreen } from './LandingScreen';
import { GenesisFlow } from './GenesisFlow';
import { ChamberLoadingScreen } from './ChamberLoadingScreen';

interface Props {
  children: React.ReactNode;
}

export function GenesisGate({ children }: Props) {
  const { minds, showLanding, mindsChecked, runtimePhase, switchingAccountLogin } = useAppState();
  const dispatch = useAppDispatch();
  const [mode, setMode] = useState<'idle' | 'genesis'>('idle');

  // Popout windows skip the gate entirely
  const params = new URLSearchParams(window.location.search);
  if (params.get('popout') === 'true') {
    return <>{children}</>;
  }

  // Show loading screen while initial minds check is pending
  if (!mindsChecked && !showLanding) {
    return <ChamberLoadingScreen />;
  }

  if (runtimePhase === 'switching-account') {
    return <ChamberLoadingScreen mode="switching-account" login={switchingAccountLogin} />;
  }

  const hasMinds = minds.length > 0;
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
          const dirPath = await window.electronAPI.mind.selectDirectory();
          if (dirPath) {
            await window.electronAPI.mind.add(dirPath);
            const loadedMinds = await window.electronAPI.mind.list();
            dispatch({ type: 'SET_MINDS', payload: loadedMinds });
            const newest = loadedMinds[loadedMinds.length - 1];
            if (newest) dispatch({ type: 'SET_ACTIVE_MIND', payload: newest.mindId });
            dispatch({ type: 'HIDE_LANDING' });
          }
        }}
        onClose={showLanding && hasMinds ? () => dispatch({ type: 'HIDE_LANDING' }) : undefined}
      />
    );
  }

  return <>{children}</>;
}
