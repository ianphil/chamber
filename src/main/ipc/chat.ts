// Chat IPC handlers — thin adapters for ChatService
import { ipcMain, BrowserWindow } from 'electron';
import type { ChatService } from '../services/chat/ChatService';
import type { ChatEvent } from '../../shared/types';

export function setupChatIPC(chatService: ChatService): void {
  ipcMain.handle('chat:send', async (event, mindId: string, message: string, messageId: string, model?: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;

    const emit = (evt: ChatEvent) => win.webContents.send('chat:event', mindId, messageId, evt);
    await chatService.sendMessage(mindId, message, messageId, emit, model);
  });

  ipcMain.handle('chat:listModels', async (_event, mindId: string) => {
    return chatService.listModels(mindId);
  });

  ipcMain.handle('chat:stop', async (_event, mindId: string, messageId: string) => {
    await chatService.cancelMessage(mindId, messageId);
  });

  ipcMain.handle('chat:newConversation', async (_event, mindId: string) => {
    await chatService.newConversation(mindId);
  });
}
