import { useEffect, useCallback, useRef } from 'react';
import { useAppState, useAppDispatch } from '../lib/store';
import { generateId } from '../lib/utils';

export function useChatStreaming() {
  const { conversationId, isStreaming } = useAppState();
  const dispatch = useAppDispatch();
  const currentMessageId = useRef<string | null>(null);

  useEffect(() => {
    const unsub = window.electronAPI.chat.onEvent((messageId, event) => {
      dispatch({ type: 'CHAT_EVENT', payload: { messageId, event } });
      if (event.type === 'done' || event.type === 'error') {
        currentMessageId.current = null;
      }
    });

    return () => { unsub(); };
  }, [dispatch]);

  const sendMessage = useCallback(async (content: string) => {
    if (isStreaming || !content.trim()) return;

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

    await window.electronAPI.chat.send(conversationId, content.trim(), assistantId);
  }, [conversationId, isStreaming, dispatch]);

  const stopStreaming = useCallback(async () => {
    if (currentMessageId.current) {
      await window.electronAPI.chat.stop(conversationId, currentMessageId.current);
    }
  }, [conversationId]);

  return { sendMessage, stopStreaming, isStreaming };
}
