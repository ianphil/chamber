import { useCallback } from 'react';
import type { OnboardingMindRequest, OnboardingMindResult } from '@chamber/plugin-api';
import { useAppDispatch } from '../lib/store';
import { selectPreferredMind } from '../lib/mindSelection';

/**
 * Implements the plugin onboarding `createMind` capability. Chamber owns all
 * Electron access: install the template, optionally seed the onboarding
 * document, then select the new mind as active.
 *
 * Mind creation is the atomic deliverable and seeding is best-effort: when the
 * mind is created but the optional document fails to seed, the renderer is still
 * synced to the main process and the failure is reported via `seedError` without
 * stranding the new mind. `success: false` means no mind was created.
 */
export function useCreateMind(): (request: OnboardingMindRequest) => Promise<OnboardingMindResult> {
  const dispatch = useAppDispatch();
  return useCallback(async (request: OnboardingMindRequest): Promise<OnboardingMindResult> => {
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
}
