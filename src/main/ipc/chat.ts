// Chat IPC handlers — wire ChatService to renderer via ipcMain
import { ipcMain, BrowserWindow } from 'electron';
import { ChatService } from '../services/ChatService';

export function setupChatIPC(chatService: ChatService): void {
  ipcMain.handle('chat:send', async (_event, conversationId: string, message: string, messageId: string) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;

    await chatService.sendMessage(
      conversationId,
      message,
      messageId,
      (msgId, chunk) => win.webContents.send('chat:chunk', msgId, chunk),
      (msgId, fullContent) => win.webContents.send('chat:done', msgId, fullContent),
      (msgId, error) => win.webContents.send('chat:error', msgId, error),
    );
  });

  ipcMain.handle('chat:stop', async (_event, conversationId: string, messageId: string) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;

    await chatService.cancelMessage(
      conversationId,
      messageId,
      (msgId) => win.webContents.send('chat:done', msgId),
    );
  });
}
