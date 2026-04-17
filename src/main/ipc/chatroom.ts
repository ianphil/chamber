import { ipcMain, BrowserWindow } from 'electron';
import type { ChatroomService } from '../services/chatroom/ChatroomService';
import type { OrchestrationMode, GroupChatConfig } from '../../shared/chatroom-types';

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

  ipcMain.handle('chatroom:set-orchestration', async (_event, mode: OrchestrationMode, config?: GroupChatConfig) => {
    chatroomService.setOrchestration(mode, config);
  });

  ipcMain.handle('chatroom:get-orchestration', async () => {
    return chatroomService.getOrchestration();
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
