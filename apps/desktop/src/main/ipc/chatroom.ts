import { ipcMain, BrowserWindow } from 'electron';
import type { ChatroomService } from '@chamber/services';
import type { OrchestrationMode, GroupChatConfig, HandoffConfig, MagenticConfig } from '@chamber/shared/chatroom-types';

interface ChatroomSendArgs {
  message: string;
  model: string | undefined;
  roundId: string | undefined;
}

const MAX_ROUND_ID_LENGTH = 128;

function parseSendArgs(message: unknown, model: unknown, roundId: unknown): ChatroomSendArgs {
  if (typeof message !== 'string') {
    throw new TypeError(`chatroom:send: 'message' must be a string, got ${typeof message}`);
  }
  if (message.length === 0) {
    throw new TypeError(`chatroom:send: 'message' must be a non-empty string`);
  }
  if (model !== undefined && typeof model !== 'string') {
    throw new TypeError(`chatroom:send: 'model' must be a string or undefined, got ${typeof model}`);
  }
  if (roundId !== undefined) {
    if (typeof roundId !== 'string' || roundId.length === 0) {
      throw new TypeError(`chatroom:send: 'roundId' must be a non-empty string or undefined`);
    }
    if (roundId.length > MAX_ROUND_ID_LENGTH) {
      throw new TypeError(`chatroom:send: 'roundId' exceeds ${MAX_ROUND_ID_LENGTH} characters`);
    }
  }
  return { message, model, roundId };
}

export function setupChatroomIPC(chatroomService: ChatroomService): void {
  ipcMain.handle('chatroom:send', async (_event, message: unknown, model?: unknown, roundId?: unknown) => {
    const args = parseSendArgs(message, model, roundId);
    await chatroomService.broadcast(args.message, args.model, args.roundId);
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
