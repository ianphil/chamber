import { useEffect } from 'react';
import type { MindContext } from '@chamber/shared/types';
import { useAppDispatch, useAppState } from '../lib/store';

export function useMindProfiles(minds: MindContext[]) {
  const { agentProfileByMindId } = useAppState();
  const dispatch = useAppDispatch();

  useEffect(() => {
    let cancelled = false;
    const missingMinds = minds.filter((mind) => agentProfileByMindId[mind.mindId] === undefined);
    if (missingMinds.length === 0) return;

    const loadProfiles = async () => {
      await Promise.all(missingMinds.map(async (mind) => {
        try {
          const profile = await window.electronAPI.mindProfile.get(mind.mindId);
          if (cancelled) return;
          if (profile.mindId !== mind.mindId) {
            dispatch({
              type: 'SET_AGENT_PROFILE_SUMMARY',
              payload: {
                mindId: mind.mindId,
                displayName: mind.identity.name,
                avatarDataUrl: null,
                accentColor: null,
              },
            });
            return;
          }
          dispatch({
            type: 'SET_AGENT_PROFILE_SUMMARY',
            payload: {
              mindId: mind.mindId,
              displayName: profile.displayName,
              avatarDataUrl: profile.avatarDataUrl,
              accentColor: profile.accentColor,
            },
          });
        } catch (error) {
          console.warn(`Failed to load profile for mind ${mind.mindId}`, error);
          if (cancelled) return;
          dispatch({
            type: 'SET_AGENT_PROFILE_SUMMARY',
            payload: {
              mindId: mind.mindId,
              displayName: mind.identity.name,
              avatarDataUrl: null,
              accentColor: null,
            },
          });
        }
      }));
    };

    void loadProfiles();
    return () => {
      cancelled = true;
    };
  }, [agentProfileByMindId, dispatch, minds]);

  return agentProfileByMindId;
}
