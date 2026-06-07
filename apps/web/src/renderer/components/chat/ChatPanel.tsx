import { useAppState, useAppDispatch } from '../../lib/store';
import { useChatStreaming } from '../../hooks/useChatStreaming';
import { useDelayedFlag } from '../../hooks/useDelayedFlag';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';
import { WelcomeScreen } from './WelcomeScreen';
import { AgentWelcome } from './AgentWelcome';
import { Logger } from '../../lib/logger';
import { Skeleton } from '../ui/skeleton';
import { cn } from '../../lib/utils';

const log = Logger.create('ChatPanel');

export function ChatPanel() {
  const { messagesByMind, activeMindId, minds, availableModels, selectedModel, conversationViewByMind, conversationHistoryByMind, composeDraftByMind } = useAppState();
  const messages = activeMindId ? (messagesByMind[activeMindId] ?? []) : [];
  const conversationView = activeMindId ? conversationViewByMind[activeMindId] : undefined;
  const isConversationHydrating = conversationView?.status === 'hydrating';
  // The conversation hasn't settled until its saved-history list has loaded
  // and any active session has been hydrated into messages. Before that we
  // hold a loading state instead of flashing the welcome/about panel for a
  // frame and then jumping to the transcript.
  const conversationHistory = activeMindId ? conversationHistoryByMind[activeMindId] : undefined;
  const conversationStatus = conversationView?.status;
  const isConversationSettled = conversationStatus === 'ready' || conversationStatus === 'idle';
  const isConversationSettling =
    Boolean(activeMindId) &&
    messages.length === 0 &&
    !isConversationHydrating &&
    (conversationHistory === undefined || (conversationHistory.length > 0 && !isConversationSettled));
  const isLoadingConversation = isConversationHydrating || isConversationSettling;
  // Only paint the skeleton once loading outlasts a short grace window, so
  // instant (cached) loads don't flash a single-frame pulse.
  const showHydratingSkeleton = useDelayedFlag(isLoadingConversation);
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

  const activeMind = activeMindId ? minds.find((m) => m.mindId === activeMindId) : undefined;
  const showAboutPanel = messages.length === 0 && !isLoadingConversation && activeMind;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {isLoadingConversation ? (
        showHydratingSkeleton ? <ConversationHydratingSkeleton /> : null
      ) : (
        <>
          {showAboutPanel ? (
            <AgentWelcome
              mind={activeMind}
              onPickPrompt={handleDraftChange}
              disabled={isModelSwitching}
            />
          ) : messages.length === 0 ? (
            <WelcomeScreen
              onPickPrompt={handleDraftChange}
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
            placeholder={isModelSwitching ? 'Switching model…' : undefined}
            value={draft}
            onValueChange={handleDraftChange}
          />
        </>
      )}
    </div>
  );
}

/**
 * Placeholder shown while a conversation rehydrates from disk. Mirrors the
 * alternating message-bubble rhythm of the real transcript so the pane keeps
 * a stable shape instead of flashing a single centered "Loading" line that
 * then jumps to the message list.
 */
function ConversationHydratingSkeleton() {
  return (
    <div className="flex-1 overflow-y-auto" aria-busy="true" data-testid="conversation-hydrating-skeleton">
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        {[
          { mine: false, lines: 2 },
          { mine: true, lines: 1 },
          { mine: false, lines: 3 },
        ].map((row, i) => (
          <div key={i} className={cn('flex flex-col gap-2', row.mine ? 'items-end' : 'items-start')}>
            <Skeleton className="h-3 w-20" />
            <div className={cn('w-full max-w-[80%] space-y-2 rounded-2xl border border-border bg-card p-4', row.mine && 'ml-auto')}>
              {Array.from({ length: row.lines }).map((_, line) => (
                <Skeleton key={line} className={cn('h-3', line === row.lines - 1 ? 'w-[60%]' : 'w-full')} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
