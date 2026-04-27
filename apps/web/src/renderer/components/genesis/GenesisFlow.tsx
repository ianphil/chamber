import React, { useState, useCallback, useRef } from 'react';
import { useAppDispatch } from '../../lib/store';
import { VoidScreen } from './VoidScreen';
import { RoleScreen } from './RoleScreen';
import { VoiceScreen } from './VoiceScreen';
import { BootScreen } from './BootScreen';

type Stage = 'void' | 'role' | 'voice' | 'boot' | 'done';
type GenesisCreateResult = Awaited<ReturnType<typeof window.electronAPI.genesis.create>>;

interface Props {
  onComplete: () => void;
}

export function GenesisFlow({ onComplete }: Props) {
  const [stage, setStage] = useState<Stage>('void');
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  // Store voice description for the create call
  const [voiceDesc, setVoiceDesc] = useState('');
  const creationPromiseRef = useRef<Promise<GenesisCreateResult> | null>(null);
  const dispatch = useAppDispatch();

  const handleBegin = useCallback(() => setStage('voice'), []);

  const handleRole= useCallback(async (r: string) => {
    setRole(r);
    setStage('boot');

    const defaultPath = await window.electronAPI.genesis.getDefaultPath();
    const creationPromise = window.electronAPI.genesis.create({
      name: name,
      role: r,
      voice: name,
      voiceDescription: voiceDesc,
      basePath: defaultPath,
    }).catch((error: unknown) => ({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }));
    creationPromiseRef.current = creationPromise;
    const result = await creationPromise;

    if (!result.success) {
      console.error('[Genesis] Failed:', result.error);
    }
  }, [name, voiceDesc]);

  const handleVoiceWithDesc = useCallback((voiceName: string, desc: string) => {
    setName(voiceName);
    setVoiceDesc(desc);
    setTimeout(() => setStage('role'), 300);
  }, []);

  const handleBootComplete = useCallback(async () => {
    const result = await creationPromiseRef.current;
    if (!result?.success) {
      if (result?.error) console.error('[Genesis] Failed:', result.error);
      return;
    }

    const loadedMinds = await window.electronAPI.mind.list();
    dispatch({ type: 'SET_MINDS', payload: loadedMinds });
    const newest = loadedMinds[loadedMinds.length - 1];
    if (newest) {
      dispatch({ type: 'SET_ACTIVE_MIND', payload: newest.mindId });
    }
    dispatch({ type: 'NEW_CONVERSATION' });
    setStage('done');
    onComplete();
  }, [dispatch, onComplete]);

  switch (stage) {
    case 'void':
      return <VoidScreen onBegin={handleBegin} />;
    case 'voice':
      return <VoiceScreen onSelect={handleVoiceWithDesc} />;
    case 'role':
      return <RoleScreen name={name} onSelect={handleRole} />;
    case 'boot':
      return <BootScreen name={name} role={role} onComplete={handleBootComplete} />;
    case 'done':
      return null;
    default:
      return null;
  }
}
