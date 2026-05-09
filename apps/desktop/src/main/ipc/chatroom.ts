import { ipcMain, BrowserWindow } from 'electron';
import { z } from 'zod';
import { IPC, parseIpcArgs } from '@chamber/shared';
import type { ChatroomService } from '@chamber/services';
import type { OrchestrationMode, GroupChatConfig, HandoffConfig, MagenticConfig, ChatroomStateChange } from '@chamber/shared/chatroom-types';

const MAX_ROUND_ID_LENGTH = 128;

const sendArgsSchema = z.object({
  message: z.string().min(1, 'must be a non-empty string'),
  model: z.string().optional(),
  roundId: z
    .string()
    .min(1, 'must be a non-empty string when provided')
    .max(MAX_ROUND_ID_LENGTH, `must be at most ${MAX_ROUND_ID_LENGTH} characters`)
    .optional(),
});

export function setupChatroomIPC(chatroomService: ChatroomService): void {
  ipcMain.handle(IPC.CHATROOM.SEND, async (_event, message: unknown, model?: unknown, roundId?: unknown) => {
    const parsed = parseIpcArgs(
      IPC.CHATROOM.SEND,
      sendArgsSchema,
      { message, model, roundId },
    );
    await chatroomService.broadcast(parsed.message, parsed.model, parsed.roundId);
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
