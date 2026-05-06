import { ipcMain } from 'electron';
import type { ChatService } from '@chamber/services';

export function setupConversationHistoryIPC(chatService: ChatService): void {
  ipcMain.handle('conversationHistory:list', async (_event, mindId: string) =>
    chatService.listConversationHistory(mindId));

  ipcMain.handle('conversationHistory:resume', async (_event, mindId: string, sessionId: string) =>
    chatService.resumeConversation(mindId, sessionId));

  ipcMain.handle('conversationHistory:rename', async (_event, mindId: string, sessionId: string, title: string) =>
    chatService.renameConversation(mindId, sessionId, title));
}
