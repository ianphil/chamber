// Chat IPC handlers — thin adapters for ChatService
import { ipcMain, BrowserWindow } from 'electron';
import { IPC } from '@chamber/shared';
import type { ChatService, MindManager } from '@chamber/services';
import type { ChatEvent, ChatImageAttachment } from '@chamber/shared/types';

export function setupChatIPC(chatService: ChatService, mindManager: MindManager): void {
  ipcMain.handle(IPC.CHAT.SEND, async (event, mindId: string, message: string, messageId: string, model?: string, attachments?: ChatImageAttachment[]) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;

    const emit = (evt: ChatEvent) => win.webContents.send(IPC.CHAT.EVENT, mindId, messageId, evt);
    await chatService.sendMessage(mindId, message, messageId, emit, model, attachments);
  });

  ipcMain.handle(IPC.CHAT.LIST_MODELS, async (_event, mindId?: string) => {
    // Fall back to any available mind if no mindId provided
    const id = mindId ?? mindManager.getActiveMindId() ?? mindManager.listMinds()[0]?.mindId;
    if (!id) return [];
    return chatService.listModels(id);
  });

  ipcMain.handle(IPC.CHAT.REFRESH_MODELS, async (_event, mindId: string) => {
    if (!mindId) {
      throw new Error('refreshModels requires an explicit mindId — cannot reload "any" mind.');
    }
    return chatService.refreshModels(mindId);
  });

  ipcMain.handle(IPC.CHAT.STOP, async (event, mindId: string, messageId: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    await chatService.cancelMessage(mindId, messageId);
    if (win) win.webContents.send(IPC.CHAT.EVENT, mindId, messageId, { type: 'done' });
  });

  ipcMain.handle(IPC.CHAT.NEW_CONVERSATION, async (_event, mindId: string) => {
    return chatService.newConversation(mindId);
  });
}
