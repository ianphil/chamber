import { useCallback } from 'react';
import { useAppDispatch } from '../lib/store';

/**
 * Starts a fresh conversation for a mind and routes the UI back to chat.
 *
 * Encapsulates the newConversation IPC + chatroom reset + store hydration so
 * the flow is not duplicated between the conversation history panel and the
 * composer `/new` slash command.
 */
export function useNewConversation(): (mindId: string) => Promise<void> {
  const dispatch = useAppDispatch();

  return useCallback(async (mindId: string) => {
    const result = await window.electronAPI.chat.newConversation(mindId);
    await window.electronAPI.chatroom.clear();
    dispatch({
      type: 'RESUME_CONVERSATION',
      payload: {
        mindId,
        sessionId: result.sessionId,
        messages: result.messages,
        conversations: result.conversations,
      },
    });
    dispatch({ type: 'SET_ACTIVE_VIEW', payload: 'chat' });
  }, [dispatch]);
}
