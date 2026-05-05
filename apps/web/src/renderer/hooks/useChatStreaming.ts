import { useCallback, useRef } from 'react';
import { useAppState, useAppDispatch } from '../lib/store';
import { generateId } from '../lib/utils';
import type { ChatImageAttachment, ImageBlock } from '@chamber/shared/types';

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

    await window.electronAPI.chat.send(activeMindId, content.trim(), assistantId, selectedModel ?? undefined, attachments);
  }, [activeMindId, isStreaming, selectedModel, dispatch]);

  const stopStreaming = useCallback(async () => {
    if (currentMessageId.current && activeMindId) {
      await window.electronAPI.chat.stop(activeMindId, currentMessageId.current);
    }
  }, [activeMindId]);

  return { sendMessage, stopStreaming, isStreaming };
}
