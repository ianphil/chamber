// Chat IPC handlers — thin adapters for ChatService
import { ipcMain, BrowserWindow } from 'electron';
import type { ChatService } from '../services/chat/ChatService';
import type { MindManager } from '../services/mind';
import type { ChatEvent, ChatImageAttachment } from '../../shared/types';

export function setupChatIPC(chatService: ChatService, mindManager: MindManager): void {
  ipcMain.handle('chat:send', async (event, mindId: string, message: string, messageId: string, model?: string, attachments?: ChatImageAttachment[]) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;

    const emit = (evt: ChatEvent) => win.webContents.send('chat:event', mindId, messageId, evt);
    await chatService.sendMessage(mindId, message, messageId, emit, model, attachments);
  });

  ipcMain.handle('chat:listModels', async (_event, mindId?: string) => {
    // Fall back to any available mind if no mindId provided
    const id = mindId ?? mindManager.getActiveMindId() ?? mindManager.listMinds()[0]?.mindId;
    if (!id) return [];
    return chatService.listModels(id);
  });

  ipcMain.handle('chat:stop', async (event, mindId: string, messageId: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    await chatService.cancelMessage(mindId, messageId);
    if (win) win.webContents.send('chat:event', mindId, messageId, { type: 'done' });
  });

  ipcMain.handle('chat:newConversation', async (_event, mindId: string) => {
    await chatService.newConversation(mindId);
  });
}
