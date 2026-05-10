import { ipcMain } from 'electron';
import { IPC } from '@chamber/shared';
import type { ChatService } from '@chamber/services';

export function setupConversationHistoryIPC(chatService: ChatService): void {
  ipcMain.handle(IPC.CONVERSATION_HISTORY.LIST, async (_event, mindId: string) =>
    chatService.listConversationHistory(mindId));

  ipcMain.handle(IPC.CONVERSATION_HISTORY.RESUME, async (_event, mindId: string, sessionId: string) =>
    chatService.resumeConversation(mindId, sessionId));

  ipcMain.handle(IPC.CONVERSATION_HISTORY.RENAME, async (_event, mindId: string, sessionId: string, title: string) =>
    chatService.renameConversation(mindId, sessionId, title));

  ipcMain.handle(IPC.CONVERSATION_HISTORY.DELETE, async (_event, mindId: string, sessionId: string) =>
    chatService.deleteConversation(mindId, sessionId));
}
