// Chatroom IPC adapter — thin bridge from ipcMain to the Dispatcher.
import { ipcMain } from 'electron';
import type { ChatroomService } from '../services/chatroom/ChatroomService';
import type { Dispatcher } from '../rpc/dispatcher';
import type { PushBus } from '../rpc/pushBus';
import { registerChatroomHandlers, CHATROOM_CHANNELS } from '../rpc/handlers/chatroom';
import { makeIpcBridge } from './bridge';

export function setupChatroomIPC(
  dispatcher: Dispatcher,
  pushBus: PushBus,
  chatroomService: ChatroomService,
): void {
  registerChatroomHandlers(dispatcher, chatroomService, pushBus);
  for (const channel of CHATROOM_CHANNELS) {
    ipcMain.handle(channel, makeIpcBridge(dispatcher, channel));
  }
}
