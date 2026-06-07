import { ipcMain, BrowserWindow } from 'electron';
import { z } from 'zod';
import { IPC, parseIpcArgs } from '@chamber/shared';
import type { ChatroomService } from '@chamber/services';
import type { ChatroomStateChange } from '@chamber/shared/chatroom-types';

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

const groupChatConfigSchema = z
  .object({
    moderatorMindId: z.string().min(1),
    maxTurns: z.number().int().positive(),
    minRounds: z.number().int().nonnegative(),
    maxSpeakerRepeats: z.number().int().positive(),
  })
  .strict();

const handoffConfigSchema = z
  .object({
    initialMindId: z.string().min(1).optional(),
    maxHandoffHops: z.number().int().positive(),
  })
  .strict();

const magenticConfigSchema = z
  .object({
    managerMindId: z.string().min(1),
    maxSteps: z.number().int().positive(),
    allowedMindIds: z.array(z.string().min(1)).optional(),
  })
  .strict();

// `chatroom:set-orchestration` is dispatched as two positional args
// `(mode, config?)`. Mode is one of five string literals; config is
// discriminated by mode. `concurrent` and `sequential` carry no config;
// the other three modes accept their respective per-mode config or
// nothing (the renderer fires the IPC call with `undefined` first when
// switching modes, then a second time with the auto-default config —
// see apps/web/src/renderer/components/chatroom/OrchestrationPicker.tsx).
const setOrchestrationArgsSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('concurrent'), config: z.undefined() }),
  z.object({ mode: z.literal('sequential'), config: z.undefined() }),
  z.object({ mode: z.literal('group-chat'), config: groupChatConfigSchema.optional() }),
  z.object({ mode: z.literal('handoff'), config: handoffConfigSchema.optional() }),
  z.object({ mode: z.literal('magentic'), config: magenticConfigSchema.optional() }),
]);

export function setupChatroomIPC(chatroomService: ChatroomService): void {
  ipcMain.handle(IPC.CHATROOM.SEND, async (_event, message: unknown, model?: unknown, roundId?: unknown) => {
    const parsed = parseIpcArgs(
      IPC.CHATROOM.SEND,
      sendArgsSchema,
      { message, model, roundId },
    );
    await chatroomService.broadcast(parsed.message, parsed.roundId, parsed.model);
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

  ipcMain.handle(IPC.CHATROOM.SET_ORCHESTRATION, async (_event, mode: unknown, config?: unknown) => {
    const parsed = parseIpcArgs(
      IPC.CHATROOM.SET_ORCHESTRATION,
      setOrchestrationArgsSchema,
      { mode, config },
    );
    chatroomService.setOrchestration(parsed.mode, parsed.config);
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

  // ---------------------------------------------------------------------
  // Sessions
  //
  // Thin adapters: every method delegates to ChatroomService and returns
  // either a single summary, a list, or a (session, messages, taskLedger)
  // resume payload. Errors propagate as Promise rejections so the
  // renderer can show them via the existing alert / toast surface.
  // ---------------------------------------------------------------------

  ipcMain.handle(IPC.CHATROOM.LIST_SESSIONS, async () => {
    return chatroomService.listSessions();
  });

  ipcMain.handle(IPC.CHATROOM.CREATE_SESSION, async (_event, title?: unknown) => {
    const cleaned = typeof title === 'string' ? title : undefined;
    return chatroomService.createSession(cleaned);
  });

  ipcMain.handle(IPC.CHATROOM.RESUME_SESSION, async (_event, sessionId: unknown) => {
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      throw new Error('resumeSession requires a sessionId');
    }
    return chatroomService.resumeSession(sessionId);
  });

  ipcMain.handle(IPC.CHATROOM.RENAME_SESSION, async (_event, sessionId: unknown, title: unknown) => {
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      throw new Error('renameSession requires a sessionId');
    }
    if (typeof title !== 'string') {
      throw new Error('renameSession requires a title');
    }
    return chatroomService.renameSession(sessionId, title);
  });

  ipcMain.handle(IPC.CHATROOM.DELETE_SESSION, async (_event, sessionId: unknown) => {
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      throw new Error('deleteSession requires a sessionId');
    }
    return chatroomService.deleteSession(sessionId);
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
