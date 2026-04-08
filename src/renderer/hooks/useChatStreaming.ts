import { useEffect, useCallback, useRef } from 'react';
import { useAppState, useAppDispatch } from '../lib/store';
import { generateId } from '../lib/utils';

export function useChatStreaming() {
  const { conversationId, isStreaming } = useAppState();
  const dispatch = useAppDispatch();
  const currentMessageId = useRef<string | null>(null);

  useEffect(() => {
    const unsubChunk = window.electronAPI.chat.onChunk((messageId, content) => {
      dispatch({ type: 'APPEND_CHUNK', payload: { messageId, content } });
    });

    const unsubDone = window.electronAPI.chat.onDone((messageId) => {
      dispatch({ type: 'FINISH_STREAMING', payload: { messageId } });
      currentMessageId.current = null;
    });

    const unsubError = window.electronAPI.chat.onError((messageId, error) => {
      dispatch({ type: 'SET_ERROR', payload: { messageId, error } });
      currentMessageId.current = null;
    });

    return () => {
      unsubChunk();
      unsubDone();
      unsubError();
    };
  }, [dispatch]);

  const sendMessage = useCallback(async (content: string) => {
    if (isStreaming || !content.trim()) return;

    const userMessage = {
      id: generateId(),
      role: 'user' as const,
      content: content.trim(),
      timestamp: Date.now(),
    };
    dispatch({ type: 'ADD_USER_MESSAGE', payload: userMessage });

    const assistantId = generateId();
    currentMessageId.current = assistantId;
    dispatch({
      type: 'ADD_ASSISTANT_MESSAGE',
      payload: {
        id: assistantId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        isStreaming: true,
      },
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
