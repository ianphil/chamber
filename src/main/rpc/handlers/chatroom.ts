import type { Dispatcher } from '../dispatcher';
import type { PushBus } from '../pushBus';
import type { ChatroomService } from '../../services/chatroom/ChatroomService';
import type { ChatroomEventPush } from '../../../contracts/outbound';
import {
  ChatroomClearArgs,
  ChatroomHistoryArgs,
  ChatroomSendArgs,
  ChatroomStopArgs,
} from '../../../contracts/chatroom';

export const CHATROOM_CHANNELS = [
  'chatroom:send',
  'chatroom:history',
  'chatroom:clear',
  'chatroom:stop',
] as const;

/**
 * Register chatroom handlers + bridge the service's streaming events
 * through the {@link PushBus}. chatroom:event is a broadcast push (every
 * window sees every turn), not a caller-scoped reply.
 */
export function registerChatroomHandlers(
  dispatcher: Dispatcher,
  chatroomService: ChatroomService,
  pushBus: PushBus,
): void {
  dispatcher.register('chatroom:send', ChatroomSendArgs, async ([message, model]) => {
    await chatroomService.broadcast(message, model);
  });

  dispatcher.register('chatroom:history', ChatroomHistoryArgs, async () => {
    return chatroomService.getHistory();
  });

  dispatcher.register('chatroom:clear', ChatroomClearArgs, async () => {
    await chatroomService.clearHistory();
  });

  dispatcher.register('chatroom:stop', ChatroomStopArgs, async () => {
    chatroomService.stopAll();
  });

  chatroomService.on('chatroom:event', (event: ChatroomEventPush) => {
    pushBus.publish('chatroom:event', event);
  });
}
