import React, { useState, useCallback, useRef } from 'react';
import { useAppDispatch } from '../../lib/store';
import { Logger } from '../../lib/logger';
import { VoidScreen } from './VoidScreen';
import { RoleScreen } from './RoleScreen';
import { VoiceScreen } from './VoiceScreen';
import { BootScreen } from './BootScreen';
import { selectPreferredMind } from '../../lib/mindSelection';
import type { GenesisMindTemplate } from '@chamber/shared/types';

type Stage = 'void' | 'role' | 'voice' | 'boot' | 'done';
type GenesisCreateResult = Awaited<ReturnType<typeof window.electronAPI.genesis.create>>;

const log = Logger.create('Genesis');

interface Props {
  onComplete: () => void;
}

export function GenesisFlow({ onComplete }: Props) {
  const [stage, setStage] = useState<Stage>('void');
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  // Store voice description for the create call
  const [voiceDesc, setVoiceDesc] = useState('');
  const [templates, setTemplates] = useState<GenesisMindTemplate[]>([]);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [creationError, setCreationError] = useState<string | null>(null);
  const creationPromiseRef = useRef<Promise<GenesisCreateResult> | null>(null);
  const dispatch = useAppDispatch();

  const loadTemplates = useCallback(async () => {
    setTemplateError(null);
    try {
      setTemplates(await window.electronAPI.genesis.listTemplates());
    } catch (error) {
      setTemplateError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const handleBegin = useCallback(() => {
    setStage('voice');
    void loadTemplates();
  }, [loadTemplates]);

  const handleAddMarketplace = useCallback(async (url: string): Promise<{ success: boolean; message: string }> => {
    const result = await window.electronAPI.marketplace.addGenesisRegistry(url);
    if (!result.success) {
      return { success: false, message: result.error };
    }
    await loadTemplates();
    return { success: true, message: `Added ${result.registry.label}. It will appear in New Agent templates.` };
  }, [loadTemplates]);

  const handleRole= useCallback(async (r: string) => {
    setRole(r);
    setStage('boot');
    setCreationError(null);

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
      setCreationError(result.error ?? 'Genesis failed.');
      log.error('Failed:', result.error);
    }
  }, [name, voiceDesc]);

  const handleVoiceWithDesc = useCallback((voiceName: string, desc: string) => {
    setName(voiceName);
    setVoiceDesc(desc);
    setTimeout(() => setStage('role'), 300);
  }, []);

  const handleTemplateSelect = useCallback(async (template: GenesisMindTemplate) => {
    setName(template.displayName);
    setRole(template.role);
    setVoiceDesc(template.voice);
    setStage('boot');
    setCreationError(null);

    const defaultPath = await window.electronAPI.genesis.getDefaultPath();
    const creationPromise = window.electronAPI.genesis.createFromTemplate({
      templateId: template.id,
      marketplaceId: template.source.marketplaceId,
      basePath: defaultPath,
    }).catch((error: unknown) => ({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }));
    creationPromiseRef.current = creationPromise;
    const result = await creationPromise;

    if (!result.success) {
      setCreationError(result.error ?? 'Genesis template install failed.');
      log.error('Template install failed:', result.error);
    }
  }, []);

  const handleBootComplete = useCallback(async () => {
    const result = await creationPromiseRef.current;
    if (!result?.success) {
      if (result?.error) setCreationError(result.error);
      if (result?.error) log.error('Failed:', result.error);
      return;
    }

    const loadedMinds = await window.electronAPI.mind.list();
    dispatch({ type: 'SET_MINDS', payload: loadedMinds });
    const mindToSelect = selectPreferredMind(loadedMinds, { mindId: result.mindId, mindPath: result.mindPath });
    if (mindToSelect) {
      dispatch({ type: 'SET_ACTIVE_MIND', payload: mindToSelect.mindId });
    }
    dispatch({ type: 'NEW_CONVERSATION' });
    setStage('done');
    onComplete();
  }, [dispatch, onComplete]);

  switch (stage) {
    case 'void':
      return <VoidScreen onBegin={handleBegin} onAddMarketplace={handleAddMarketplace} />;
    case 'voice':
      return (
        <VoiceScreen
          templates={templates}
          templateError={templateError}
          onSelect={handleVoiceWithDesc}
          onSelectTemplate={handleTemplateSelect}
        />
      );
    case 'role':
      return <RoleScreen name={name} onSelect={handleRole} />;
    case 'boot':
      return (
        <>
          <BootScreen name={name} role={role} onComplete={handleBootComplete} />
          {creationError ? (
            <div role="alert" className="fixed top-6 left-1/2 z-[60] -translate-x-1/2 rounded-lg border border-red-500/40 bg-black px-4 py-2 text-sm text-red-300">
              {creationError}
            </div>
          ) : null}
        </>
      );
    case 'done':
      return null;
    default:
      return null;
  }
}
