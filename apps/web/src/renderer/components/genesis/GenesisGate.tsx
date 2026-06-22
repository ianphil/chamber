import React, { useCallback, useState } from 'react';
import type { OnboardingMindRequest, OnboardingMindResult } from '@chamber/plugin-api';
import { useAppState, useAppDispatch } from '../../lib/store';
import { MacTitlebarDrag } from '../layout/MacTitlebarDrag';
import { LandingScreen } from './LandingScreen';
import { GenesisFlow } from './GenesisFlow';
import { ChamberLoadingScreen } from './ChamberLoadingScreen';
import { selectPreferredMind } from '../../lib/mindSelection';
import { useChamberPlugin } from '../../lib/plugin/ChamberPluginContext';

interface Props {
  children: React.ReactNode;
}

export function GenesisGate({ children }: Props) {
  const { minds, showLanding, mindsChecked, runtimePhase, switchingAccountLogin } = useAppState();
  const dispatch = useAppDispatch();
  const plugin = useChamberPlugin();
  const Onboarding = plugin.onboarding ?? GenesisFlow;
  const [mode, setMode] = useState<'idle' | 'genesis'>('idle');
  const [openExistingError, setOpenExistingError] = useState<string | null>(null);

  // Implementation of the plugin onboarding's `createMind` capability. Chamber
  // owns all Electron access here: install the template, optionally seed the
  // onboarding document, then select the new mind. The plugin only describes
  // what it wants and decides when to call onComplete.
  const createMind = useCallback(async (request: OnboardingMindRequest): Promise<OnboardingMindResult> => {
    try {
      const basePath = await window.electronAPI.genesis.getDefaultPath();
      const result = await window.electronAPI.genesis.createFromTemplate({
        templateId: request.templateId,
        marketplaceId: request.marketplaceId,
        basePath,
      });
      if (!result.success || !result.mindId) {
        return { success: false, error: result.error ?? 'Failed to create agent.' };
      }

      // The mind now exists and is the active mind in the main process. Seeding
      // the optional document is best-effort: a failure must not strand the new
      // mind, so we record it as non-fatal and still sync the renderer to the
      // main process below.
      let seedError: string | undefined;
      if (request.seedDocument && request.seedDocument.trim()) {
        const seeded = await window.electronAPI.genesis.seedDocument(result.mindId, request.seedDocument);
        if (!seeded.success) {
          seedError = seeded.error ?? 'Failed to seed onboarding document.';
        }
      }

      const loadedMinds = await window.electronAPI.mind.list();
      dispatch({ type: 'SET_MINDS', payload: loadedMinds });
      const mindToSelect = selectPreferredMind(loadedMinds, { mindId: result.mindId, mindPath: result.mindPath });
      if (mindToSelect) dispatch({ type: 'SET_ACTIVE_MIND', payload: mindToSelect.mindId });
      dispatch({ type: 'NEW_CONVERSATION' });
      return { success: true, mindId: result.mindId, seedError };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to create agent.' };
    }
  }, [dispatch]);

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

  // If in genesis flow, show it (a plugin may override the built-in flow)
  if (mode === 'genesis') {
    return (
      <>
        <Onboarding
          onComplete={() => {
            setMode('idle');
            dispatch({ type: 'HIDE_LANDING' });
          }}
          createMind={createMind}
        />
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
