import React from 'react';
import { useAppState, useAppDispatch } from '../../lib/store';
import { useChatStreaming } from '../../hooks/useChatStreaming';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';
import { WelcomeScreen } from './WelcomeScreen';

export function ChatPanel() {
  const { messagesByMind, activeMindId, minds, availableModels, selectedModel } = useAppState();
  const messages = activeMindId ? (messagesByMind[activeMindId] ?? []) : [];
  const connected = minds.length > 0;
  const dispatch = useAppDispatch();
  const { sendMessage, stopStreaming, isStreaming } = useChatStreaming();

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {messages.length === 0 ? (
        <WelcomeScreen
          onSendMessage={sendMessage}
          connected={connected}
        />
      ) : (
        <MessageList />
      )}

      <ChatInput
        onSend={sendMessage}
        onStop={stopStreaming}
        isStreaming={isStreaming}
        disabled={!connected}
        availableModels={availableModels}
        selectedModel={selectedModel}
        onModelChange={(model) => {
          if (activeMindId) void window.electronAPI.mind.setModel(activeMindId, model);
          dispatch({ type: 'SET_SELECTED_MODEL', payload: model });
        }}
      />
    </div>
  );
}
