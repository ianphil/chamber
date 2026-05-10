import { useCallback, useRef } from 'react';
import { useAppState, useAppDispatch } from '../lib/store';
import { generateId } from '../lib/utils';
import type { ChatImageAttachment, ImageBlock } from '@chamber/shared/types';
import { Logger } from '../lib/logger';

const log = Logger.create('useChatStreaming');

export function useChatStreaming() {
  const { activeMindId, isStreaming, selectedModel } = useAppState();
  const dispatch = useAppDispatch();
  const currentMessageId = useRef<string | null>(null);

  const sendMessage = useCallback(async (content: string, attachments?: ChatImageAttachment[]) => {
    const hasText = content.trim().length > 0;
    const hasAttachments = !!attachments && attachments.length > 0;
    if (isStreaming || (!hasText && !hasAttachments) || !activeMindId) return;

    const images: ImageBlock[] | undefined = attachments?.map((a) => ({
      type: 'image',
      name: a.name,
      mimeType: a.mimeType,
      dataUrl: `data:${a.mimeType};base64,${a.data}`,
    }));

    const userMessage = {
      id: generateId(),
      content: content.trim(),
      timestamp: Date.now(),
      images,
    };
    dispatch({ type: 'ADD_USER_MESSAGE', payload: userMessage });

    const assistantId = generateId();
    currentMessageId.current = assistantId;
    dispatch({
      type: 'ADD_ASSISTANT_MESSAGE',
      payload: { id: assistantId, timestamp: Date.now() },
    });

    const mindId = activeMindId;
    await window.electronAPI.chat.send(mindId, content.trim(), assistantId, selectedModel ?? undefined, attachments);
    try {
      const conversations = await window.electronAPI.conversationHistory.list(mindId);
      dispatch({ type: 'SET_CONVERSATION_HISTORY', payload: { mindId, conversations } });
    } catch (error) {
      log.warn('Failed to refresh conversation history after send:', error);
    }
  }, [activeMindId, isStreaming, selectedModel, dispatch]);

  const stopStreaming = useCallback(async () => {
    if (currentMessageId.current && activeMindId) {
      await window.electronAPI.chat.stop(activeMindId, currentMessageId.current);
    }
  }, [activeMindId]);

  return { sendMessage, stopStreaming, isStreaming };
}
