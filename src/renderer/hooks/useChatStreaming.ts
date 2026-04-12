import { useCallback, useRef } from 'react';
import { useAppState, useAppDispatch } from '../lib/store';
import { generateId } from '../lib/utils';

export function useChatStreaming() {
  const { activeMindId, isStreaming, selectedModel } = useAppState();
  const dispatch = useAppDispatch();
  const currentMessageId = useRef<string | null>(null);

  const sendMessage = useCallback(async (content: string) => {
    if (isStreaming || !content.trim() || !activeMindId) return;

    const userMessage = {
      id: generateId(),
      content: content.trim(),
      timestamp: Date.now(),
    };
    dispatch({ type: 'ADD_USER_MESSAGE', payload: userMessage });

    const assistantId = generateId();
    currentMessageId.current = assistantId;
    dispatch({
      type: 'ADD_ASSISTANT_MESSAGE',
      payload: { id: assistantId, timestamp: Date.now() },
    });

    await window.electronAPI.chat.send(activeMindId, content.trim(), assistantId, selectedModel ?? undefined);
  }, [activeMindId, isStreaming, selectedModel, dispatch]);

  const stopStreaming = useCallback(async () => {
    if (currentMessageId.current && activeMindId) {
      await window.electronAPI.chat.stop(activeMindId, currentMessageId.current);
    }
  }, [activeMindId]);

  return { sendMessage, stopStreaming, isStreaming };
}
