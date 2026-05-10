import React, { useState } from 'react';
import { useAppState, useAppDispatch } from '../../lib/store';
import { MacTitlebarDrag } from '../layout/MacTitlebarDrag';
import { LandingScreen } from './LandingScreen';
import { GenesisFlow } from './GenesisFlow';
import { ChamberLoadingScreen } from './ChamberLoadingScreen';
import { selectPreferredMind } from '../../lib/mindSelection';

interface Props {
  children: React.ReactNode;
}

export function GenesisGate({ children }: Props) {
  const { minds, showLanding, mindsChecked, runtimePhase, switchingAccountLogin } = useAppState();
  const dispatch = useAppDispatch();
  const [mode, setMode] = useState<'idle' | 'genesis'>('idle');
  const [openExistingError, setOpenExistingError] = useState<string | null>(null);

  // Popout windows skip the gate entirely
  const params = new URLSearchParams(window.location.search);
  if (params.get('popout') === 'true') {
    return <>{children}</>;
  }

  // Show loading screen while initial minds check is pending
  if (!mindsChecked && !showLanding) {
    return (
      <>
        <ChamberLoadingScreen />
        <MacTitlebarDrag />
      </>
    );
  }

  if (runtimePhase === 'switching-account') {
    return (
      <>
        <ChamberLoadingScreen mode="switching-account" login={switchingAccountLogin} />
        <MacTitlebarDrag />
      </>
    );
  }

  const hasMinds = minds.length > 0;
  const showGate = showLanding || !hasMinds;

  // If in genesis flow, show it
  if (mode === 'genesis') {
    return (
      <>
        <GenesisFlow onComplete={() => {
          setMode('idle');
          dispatch({ type: 'HIDE_LANDING' });
        }} />
        <MacTitlebarDrag />
      </>
    );
  }

  // Show landing if triggered or no minds loaded
  if (showGate) {
    return (
      <>
      <LandingScreen
        onNewAgent={() => {
          setOpenExistingError(null);
          setMode('genesis');
        }}
        onOpenExisting={async () => {
          setOpenExistingError(null);
          const dirPath = await window.electronAPI.mind.selectDirectory();
          if (!dirPath) return;

          try {
            const openedMind = await window.electronAPI.mind.add(dirPath);
            const loadedMinds = await window.electronAPI.mind.list();
            dispatch({ type: 'SET_MINDS', payload: loadedMinds });
            const mindToSelect = selectPreferredMind(loadedMinds, openedMind);
            if (mindToSelect) dispatch({ type: 'SET_ACTIVE_MIND', payload: mindToSelect.mindId });
            dispatch({ type: 'HIDE_LANDING' });
          } catch (error) {
            setOpenExistingError(error instanceof Error ? error.message : 'Failed to open existing agent.');
          }
        }}
        onClose={showLanding && hasMinds
          ? () => {
            setOpenExistingError(null);
            dispatch({ type: 'HIDE_LANDING' });
          }
          : undefined}
        error={openExistingError ?? undefined}
      />
      <MacTitlebarDrag />
      </>
    );
  }

  return <>{children}</>;
}
