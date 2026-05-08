import { ipcMain, BrowserWindow } from 'electron';
import { IPC } from '@chamber/shared';
import type { ChatroomService } from '@chamber/services';
import type { OrchestrationMode, GroupChatConfig, HandoffConfig, MagenticConfig, ChatroomStateChange } from '@chamber/shared/chatroom-types';

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
  ipcMain.handle(IPC.CHATROOM.SEND, async (_event, message: unknown, model?: unknown, roundId?: unknown) => {
    const args = parseSendArgs(message, model, roundId);
    await chatroomService.broadcast(args.message, args.model, args.roundId);
  });

  ipcMain.handle(IPC.CHATROOM.HISTORY, async () => {
    return chatroomService.getHistory();
  });

  ipcMain.handle(IPC.CHATROOM.TASK_LEDGER, async () => {
    return chatroomService.getTaskLedger();
  });

  ipcMain.handle(IPC.CHATROOM.CLEAR, async () => {
    await chatroomService.clearHistory();
  });

  ipcMain.handle(IPC.CHATROOM.STOP, async () => {
    chatroomService.stopAll();
  });

  ipcMain.handle(IPC.CHATROOM.SET_ORCHESTRATION, async (_event, mode: OrchestrationMode, config?: GroupChatConfig | HandoffConfig | MagenticConfig) => {
    chatroomService.setOrchestration(mode, config);
  });

  ipcMain.handle(IPC.CHATROOM.GET_ORCHESTRATION, async () => {
    return chatroomService.getOrchestration();
  });

  ipcMain.handle(IPC.CHATROOM.SET_MIND_ENABLED, async (_event, mindId: string, enabled: boolean) => {
    chatroomService.setMindEnabled(mindId, enabled);
  });

  ipcMain.handle(IPC.CHATROOM.GET_DISABLED_MIND_IDS, async () => {
    return chatroomService.getDisabledMindIds();
  });

  // Forward chatroom streaming events to all renderer windows.
  // The 'chatroom:event' string passed to chatroomService.on(...) is an internal
  // EventEmitter event name on the service, not an IPC wire channel; the
  // webContents.send call uses the IPC.CHATROOM.EVENT constant for the IPC wire.
  chatroomService.on('chatroom:event', (event) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.CHATROOM.EVENT, event);
      }
    }
  });

  // Forward authoritative state-change events (e.g. mind enable/disable)
  // on a dedicated channel so the renderer's chatroom event union stays
  // typed for streaming events only.
  chatroomService.on('chatroom:state-changed', (state: ChatroomStateChange) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.CHATROOM.STATE_CHANGED, state);
      }
    }
  });
}
