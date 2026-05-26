// Chat IPC handlers — thin adapters for ChatService
import { ipcMain, BrowserWindow } from 'electron';
import { IPC } from '@chamber/shared';
import { Logger } from '@chamber/services';
import type { ChatService, MindManager } from '@chamber/services';
import type { ChatEvent, ChatImageAttachment, ChatReplayEvent } from '@chamber/shared/types';

const log = Logger.create('ChatIPC');
const MAX_REPLAY_EVENTS = 500;
const replayEvents: ChatReplayEvent[] = [];
let chatEventSequence = 0;

function recordChatEvent(mindId: string, messageId: string, event: ChatEvent): ChatReplayEvent {
  const entry = {
    sequence: ++chatEventSequence,
    mindId,
    messageId,
    event,
  };
  replayEvents.push(entry);
  if (replayEvents.length > MAX_REPLAY_EVENTS) {
    replayEvents.splice(0, replayEvents.length - MAX_REPLAY_EVENTS);
  }
  return entry;
}

function sendChatEvent(win: BrowserWindow | null, mindId: string, messageId: string, event: ChatEvent): void {
  const entry = recordChatEvent(mindId, messageId, event);
  log.debug('chat:event:emit', {
    sequence: entry.sequence,
    mindId,
    messageId,
    type: event.type,
    windowVisible: win?.isVisible() ?? false,
    windowDestroyed: win?.isDestroyed() ?? true,
  });
  if (win && !win.isDestroyed()) {
    win.webContents.send(IPC.CHAT.EVENT, mindId, messageId, event, entry.sequence);
  }
}

export function setupChatIPC(chatService: ChatService, mindManager: MindManager): void {
  ipcMain.handle(IPC.CHAT.SEND, async (event, mindId: string, message: string, messageId: string, model?: string, attachments?: ChatImageAttachment[]) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;

    const emit = (evt: ChatEvent) => sendChatEvent(win, mindId, messageId, evt);
    await chatService.sendMessage(mindId, message, messageId, emit, model, attachments);
  });

  ipcMain.handle(IPC.CHAT.LIST_MODELS, async (_event, mindId?: string) => {
    // Fall back to any available mind if no mindId provided
    const id = mindId ?? mindManager.getActiveMindId() ?? mindManager.listMinds()[0]?.mindId;
    if (!id) return [];
    return chatService.listModels(id);
  });

  ipcMain.handle(IPC.CHAT.STOP, async (event, mindId: string, messageId: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const cancelled = await chatService.cancelMessage(mindId, messageId);
    if (cancelled) sendChatEvent(win, mindId, messageId, { type: 'done', cancelled: true });
  });

  ipcMain.handle(IPC.CHAT.NEW_CONVERSATION, async (_event, mindId: string) => {
    return chatService.newConversation(mindId);
  });

  ipcMain.handle(IPC.CHAT.GET_EVENT_SEQUENCE, () => chatEventSequence);

  ipcMain.handle(IPC.CHAT.REPLAY_EVENTS, (_event, afterSequence: number) => {
    const sequence = Number.isFinite(afterSequence) ? afterSequence : chatEventSequence;
    const missed = replayEvents.filter((entry) => entry.sequence > sequence);
    log.debug('chat:event:replay', {
      afterSequence: sequence,
      count: missed.length,
      currentSequence: chatEventSequence,
    });
    return missed;
  });
}
