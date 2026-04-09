import React, { useState, useCallback } from 'react';
import { useAppDispatch } from '../../lib/store';
import { VoidScreen } from './VoidScreen';
import { RoleScreen } from './RoleScreen';
import { VoiceScreen } from './VoiceScreen';
import { BootScreen } from './BootScreen';

type Stage = 'void' | 'role' | 'voice' | 'boot' | 'done';

interface Props {
  onComplete: () => void;
}

export function GenesisFlow({ onComplete }: Props) {
  const [stage, setStage] = useState<Stage>('void');
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const dispatch = useAppDispatch();

  const handleBegin = useCallback(() => setStage('voice'), []);

  const handleVoice = useCallback((voiceName: string, desc: string) => {
    setName(voiceName);
    setTimeout(() => setStage('role'), 300);
  }, []);

  const handleRole = useCallback(async (r: string) => {
    setRole(r);
    setStage('boot');

    const defaultPath = await window.electronAPI.genesis.getDefaultPath();
    const result = await window.electronAPI.genesis.create({
      name: name,
      role: r,
      voice: name,
      voiceDescription: voiceDesc,
      basePath: defaultPath,
    });

    if (!result.success) {
      console.error('[Genesis] Failed:', result.error);
    }
  }, [name]);

  // Store voice description for the create call
  const [voiceDesc, setVoiceDesc] = useState('');

  const handleVoiceWithDesc = useCallback((voiceName: string, desc: string) => {
    setName(voiceName);
    setVoiceDesc(desc);
    setTimeout(() => setStage('role'), 300);
  }, []);

  const handleBootComplete = useCallback(() => {
    dispatch({ type: 'NEW_CONVERSATION' });
    window.electronAPI.agent.getStatus().then((status) => {
      dispatch({ type: 'SET_AGENT_STATUS', payload: status });
    });
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
