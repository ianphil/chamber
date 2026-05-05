import { ipcMain, BrowserWindow } from 'electron';
import type { ChatroomService } from '@chamber/services';
import type { OrchestrationMode, GroupChatConfig, HandoffConfig, MagenticConfig } from '@chamber/shared/chatroom-types';

function assertSendArgs(
  message: unknown,
  model: unknown,
): asserts message is string {
  if (typeof message !== 'string') {
    throw new TypeError(`chatroom:send: 'message' must be a string, got ${typeof message}`);
  }
  if (message.length === 0) {
    throw new TypeError(`chatroom:send: 'message' must be a non-empty string`);
  }
  assertModel(model);
}

function assertModel(model: unknown): asserts model is string | undefined {
  if (model !== undefined && typeof model !== 'string') {
    throw new TypeError(`chatroom:send: 'model' must be a string or undefined, got ${typeof model}`);
  }
}

export function setupChatroomIPC(chatroomService: ChatroomService): void {
  ipcMain.handle('chatroom:send', async (_event, message: unknown, model?: unknown) => {
    assertSendArgs(message, model);
    assertModel(model);
    await chatroomService.broadcast(message, model);
  });

  ipcMain.handle('chatroom:history', async () => {
    return chatroomService.getHistory();
  });

  ipcMain.handle('chatroom:task-ledger', async () => {
    return chatroomService.getTaskLedger();
  });

  ipcMain.handle('chatroom:clear', async () => {
    await chatroomService.clearHistory();
  });

  ipcMain.handle('chatroom:stop', async () => {
    chatroomService.stopAll();
  });

  ipcMain.handle('chatroom:set-orchestration', async (_event, mode: OrchestrationMode, config?: GroupChatConfig | HandoffConfig | MagenticConfig) => {
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
