import { ipcMain, BrowserWindow } from 'electron';
import type { ChatroomService } from '../services/chatroom/ChatroomService';

export function setupChatroomIPC(chatroomService: ChatroomService): void {
  ipcMain.handle('chatroom:send', async (_event, message: string, model?: string) => {
    await chatroomService.broadcast(message, model);
  });

  ipcMain.handle('chatroom:history', async () => {
    return chatroomService.getHistory();
  });

  ipcMain.handle('chatroom:clear', async () => {
    await chatroomService.clearHistory();
  });

  ipcMain.handle('chatroom:stop', async () => {
    chatroomService.stopAll();
  });

  // Forward chatroom streaming events to all renderer windows
  chatroomService.on('chatroom:event', (event) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('chatroom:event', event);
      }
    }
  });
}
