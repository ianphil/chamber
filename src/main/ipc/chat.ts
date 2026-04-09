// Chat IPC handlers — wire ChatService to renderer via ipcMain
import { ipcMain, BrowserWindow } from 'electron';
import { ChatService } from '../services/ChatService';
import type { ChatEvent } from '../../shared/types';

export function setupChatIPC(chatService: ChatService): void {
  ipcMain.handle('chat:send', async (event, conversationId: string, message: string, messageId: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;

    const emit = (evt: ChatEvent) => win.webContents.send('chat:event', messageId, evt);

    await chatService.sendMessage(conversationId, message, messageId, emit);
  });

  ipcMain.handle('chat:stop', async (event, conversationId: string, messageId: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;

    await chatService.cancelMessage(
      conversationId,
      messageId,
      (msgId) => win.webContents.send('chat:event', msgId, { type: 'done' } as ChatEvent),
    );
  });

  ipcMain.handle('chat:newConversation', async (_event, conversationId: string) => {
    const controller = chatService.getAbortController(conversationId);
    if (controller) {
      controller.abort();
    }
    await chatService.destroySession(conversationId);
  });
}
