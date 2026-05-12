import type { SendMessageRequest, SendMessageResponse, Message } from './types';
import type { A2AAgentResolver } from './ActiveA2AResolver';
import type { ChatService } from '../chat/ChatService';
import type { EventEmitter } from 'events';
import { generateMessageId, generateContextId, serializeMessageToXml } from './helpers';
import { Logger } from '../logger';

const log = Logger.create('MessageRouter');

const MAX_HOPS = 5;
export class MessageRouter {
  constructor(
    private readonly chatService: ChatService,
    private readonly resolver: A2AAgentResolver,
    private readonly ipcEmitter: EventEmitter,
  ) {}

  async sendMessage(request: SendMessageRequest): Promise<SendMessageResponse> {
    // 1. Resolve recipient — try by mindId first, then by name
    const card = await this.resolver.getCard(request.recipient) ?? await this.resolver.getCardByName(request.recipient);
    if (!card) {
      throw new Error(`Unknown recipient: ${request.recipient}`);
    }
    // 2. Assign/preserve contextId
    const contextId = request.message.contextId || generateContextId();

    // 3. Resolve hop count from the forwarded message, not the whole context.
    const currentHops = getMessageHopCount(request.message.metadata?.hopCount);
    if (currentHops >= MAX_HOPS) {
      throw new Error(`Message exceeded maximum hop count (${MAX_HOPS})`);
    }
    const nextHops = currentHops + 1;

    // 4. Build the delivery message
    const deliveryMessage: Message = {
      ...request.message,
      contextId,
      metadata: {
        ...request.message.metadata,
        hopCount: nextHops,
      },
    };

    if (!card.mindId && this.resolver.canSendMessage?.() === true && this.resolver.sendMessage) {
      return this.resolver.sendMessage({
        ...request,
        message: deliveryMessage,
      });
    }

    if (!card.mindId) {
      throw new Error(`Unknown local recipient: ${request.recipient}`);
    }
    const targetMindId = card.mindId;

    return this.deliverLocalMessage(targetMindId, deliveryMessage, request.configuration?.returnImmediately !== false);
  }

  async deliverToLocalMind(
    targetMindId: string,
    request: SendMessageRequest,
  ): Promise<SendMessageResponse> {
    const contextId = request.message.contextId || generateContextId();
    const currentHops = getMessageHopCount(request.message.metadata?.hopCount);
    if (currentHops >= MAX_HOPS) {
      throw new Error(`Message exceeded maximum hop count (${MAX_HOPS})`);
    }
    const deliveryMessage: Message = {
      ...request.message,
      contextId,
      metadata: {
        ...request.message.metadata,
        hopCount: currentHops + 1,
      },
    };
    return this.deliverLocalMessage(targetMindId, deliveryMessage, request.configuration?.returnImmediately !== false);
  }

  private async deliverLocalMessage(
    targetMindId: string,
    deliveryMessage: Message,
    returnImmediately: boolean,
  ): Promise<SendMessageResponse> {
    const contextId = deliveryMessage.contextId || generateContextId();
    const xmlPrompt = serializeMessageToXml(deliveryMessage);
    const replyMessageId = generateMessageId();

    this.ipcEmitter.emit('a2a:incoming', {
      targetMindId,
      message: { ...deliveryMessage, contextId },
      replyMessageId,
    });

    const deliveryPromise = this.chatService.sendMessage(
      targetMindId,
      xmlPrompt,
      replyMessageId,
      (event) => {
        this.ipcEmitter.emit('a2a:chat-event', {
          mindId: targetMindId,
          messageId: replyMessageId,
          event,
        });
      },
    );

    if (!returnImmediately) {
      await deliveryPromise;
    } else {
      deliveryPromise.catch((err) => {
        log.error(`Delivery failed for ${targetMindId}:`, err);
      });
    }

    return {
      message: {
        ...deliveryMessage,
        contextId,
      },
    };
  }

}

function getMessageHopCount(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}
