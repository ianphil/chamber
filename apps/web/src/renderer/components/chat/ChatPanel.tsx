import { useCallback } from 'react';
import { useAppState, useAppDispatch } from '../../lib/store';
import { useChatStreaming } from '../../hooks/useChatStreaming';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';
import { WelcomeScreen } from './WelcomeScreen';
import { Logger } from '../../lib/logger';

const log = Logger.create('ChatPanel');

export function ChatPanel() {
  const { messagesByMind, activeMindId, minds, availableModels, selectedModel, conversationViewByMind, composeDraftByMind } = useAppState();
  const messages = activeMindId ? (messagesByMind[activeMindId] ?? []) : [];
  const conversationView = activeMindId ? conversationViewByMind[activeMindId] : undefined;
  const isConversationHydrating = conversationView?.status === 'hydrating';
  const isModelSwitching = Boolean(conversationView?.modelSwitching);
  const connected = minds.length > 0;
  const dispatch = useAppDispatch();
  const { sendMessage, stopStreaming, isStreaming } = useChatStreaming();
  // Per-mind unsent compose draft (#221). Reading from the store keeps the
  // textarea in sync when the active mind changes; writing back on every
  // edit preserves drafts for future visits to the same mind.
  const draft = activeMindId ? (composeDraftByMind[activeMindId] ?? '') : '';
  const handleDraftChange = (next: string) => {
    if (!activeMindId) return;
    dispatch({ type: 'SET_COMPOSE_DRAFT', payload: { mindId: activeMindId, draft: next } });
  };

  const handleModelChange = (model: string) => {
    if (!activeMindId || isModelSwitching) return;
    const mindId = activeMindId;
    const previousModel = selectedModel;
    dispatch({ type: 'SET_SELECTED_MODEL', payload: model });
    dispatch({ type: 'SET_MODEL_SWITCHING', payload: { mindId, switching: true } });
    window.electronAPI.mind.setModel(mindId, model)
      .then((updatedMind) => {
        if (updatedMind) dispatch({ type: 'SET_MINDS', payload: minds.map((mind) => mind.mindId === updatedMind.mindId ? updatedMind : mind) });
      })
      .catch((error: unknown) => {
        log.error('Failed to switch model:', error);
        dispatch({ type: 'SET_SELECTED_MODEL', payload: previousModel });
      })
      .finally(() => {
        dispatch({ type: 'SET_MODEL_SWITCHING', payload: { mindId, switching: false } });
      });
  };

  // Force-refresh the model catalog (#90). Restarts the underlying CLI
  // subprocess via ChatService.refreshModels — the Copilot CLI keeps its
  // model list in process memory for 30 minutes (LIST_MODELS_CACHE_TTL_MS),
  // so a reload is the only way to bust it. The destructive part is gated
  // behind a confirm dialog inside ChatInput.
  const handleRefreshModels = useCallback(async () => {
    if (!activeMindId) return;
    try {
      const fresh = await window.electronAPI.chat.refreshModels(activeMindId);
      dispatch({ type: 'SET_AVAILABLE_MODELS', payload: fresh });
    } catch (error) {
      log.error('Failed to refresh models:', error);
      throw error;
    }
  }, [activeMindId, dispatch]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {isConversationHydrating ? (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          Loading conversation…
        </div>
      ) : messages.length === 0 ? (
        <WelcomeScreen
          onSendMessage={sendMessage}
          connected={connected}
          disabled={isModelSwitching}
        />
      ) : (
        <MessageList />
      )}

      <ChatInput
        onSend={sendMessage}
        onStop={stopStreaming}
        isStreaming={isStreaming}
        disabled={!connected || isModelSwitching}
        availableModels={availableModels}
        selectedModel={selectedModel}
        onModelChange={handleModelChange}
        onRefreshModels={activeMindId ? handleRefreshModels : undefined}
        placeholder={isModelSwitching ? 'Switching model…' : undefined}
        value={draft}
        onValueChange={handleDraftChange}
      />
    </div>
  );
}
