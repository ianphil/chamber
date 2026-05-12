import { BrowserWindow, dialog, ipcMain } from 'electron';
import os from 'node:os';
import { z } from 'zod';
import { IPC, parseIpcArgs } from '@chamber/shared';
import type { SquadRoomService } from '@chamber/services';

const getRoomArgsSchema = z.object({
  repoPath: z.string().min(1).nullable().optional(),
}).strict();

const historyArgsSchema = z.object({
  roomId: z.string().min(1),
}).strict();

const sendArgsSchema = z.object({
  request: z.object({
    roomId: z.string().min(1),
    repoPath: z.string().min(1),
    prompt: z.string().min(1),
    targetAgentName: z.string().min(1).optional(),
    requestedBy: z.object({
      kind: z.enum(['user', 'chamber-mind', 'squad-coordinator', 'squad-agent', 'system']),
      id: z.string().min(1),
      name: z.string().min(1),
    }).optional(),
  }).strict(),
}).strict();

const turnArgsSchema = z.object({
  turnId: z.string().min(1),
}).strict();

export function setupSquadIPC(squadRoomService: SquadRoomService): void {
  squadRoomService.onEvent((payload) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC.SQUAD.EVENT, payload);
    }
  });

  ipcMain.handle(IPC.SQUAD.GET_ROOM, async (_event, repoPath: unknown) => {
    const parsed = parseIpcArgs(IPC.SQUAD.GET_ROOM, getRoomArgsSchema, { repoPath });
    return squadRoomService.getRoom(parsed.repoPath);
  });

  ipcMain.handle(IPC.SQUAD.SELECT_REPOSITORY, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;

    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Select Squad Repository',
      defaultPath: os.homedir(),
    });

    if (result.canceled || result.filePaths.length === 0) return null;
    return squadRoomService.getRoom(result.filePaths[0]);
  });

  ipcMain.handle(IPC.SQUAD.HISTORY, async (_event, roomId: unknown) => {
    const parsed = parseIpcArgs(IPC.SQUAD.HISTORY, historyArgsSchema, { roomId });
    return squadRoomService.history(parsed.roomId);
  });

  ipcMain.handle(IPC.SQUAD.SEND, async (_event, request: unknown) => {
    const parsed = parseIpcArgs(IPC.SQUAD.SEND, sendArgsSchema, { request });
    return squadRoomService.send(parsed.request);
  });

  ipcMain.handle(IPC.SQUAD.STOP, async (_event, turnId: unknown) => {
    const parsed = parseIpcArgs(IPC.SQUAD.STOP, turnArgsSchema, { turnId });
    await squadRoomService.stop(parsed.turnId);
  });

  ipcMain.handle(IPC.SQUAD.CLEAR, async (_event, roomId: unknown) => {
    const parsed = parseIpcArgs(IPC.SQUAD.CLEAR, historyArgsSchema, { roomId });
    await squadRoomService.clear(parsed.roomId);
  });
}
