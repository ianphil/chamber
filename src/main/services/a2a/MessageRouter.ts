import type { SendMessageRequest, SendMessageResponse, Message } from './types';
import type { AgentCardRegistry } from './AgentCardRegistry';
import type { ChatService } from '../chat/ChatService';
import type { EventEmitter } from 'events';
import { generateMessageId, generateContextId, serializeMessageToXml } from './helpers';

const MAX_HOPS = 5;

export class MessageRouter {
  private contextHops = new Map<string, number>();

  constructor(
    private readonly chatService: ChatService,
    private readonly registry: AgentCardRegistry,
    private readonly ipcEmitter: EventEmitter,
  ) {}

  async sendMessage(request: SendMessageRequest): Promise<SendMessageResponse> {
    // 1. Resolve recipient — try by mindId first, then by name
    const card = this.registry.getCard(request.recipient) ?? this.registry.getCardByName(request.recipient);
    if (!card?.mindId) {
      throw new Error(`Unknown recipient: ${request.recipient}`);
    }
    const targetMindId = card.mindId;

    // 2. Assign/preserve contextId
    const contextId = request.message.contextId || generateContextId();

    // 3. Resolve hop count from context tracking (not message metadata)
    const currentHops = this.contextHops.get(contextId) ?? 0;
    if (currentHops >= MAX_HOPS) {
      throw new Error(`Message exceeded maximum hop count (${MAX_HOPS})`);
    }
    const nextHops = currentHops + 1;
    this.contextHops.set(contextId, nextHops);

    // 4. Build the delivery message
    const deliveryMessage: Message = {
      ...request.message,
      contextId,
      metadata: {
        ...request.message.metadata,
        hopCount: nextHops,
      },
    };

    // 5. Serialize to XML for model injection
    const xmlPrompt = serializeMessageToXml(deliveryMessage);
    const replyMessageId = generateMessageId();

    // 6. Emit a2a:incoming for renderer (before delivery)
    this.ipcEmitter.emit('a2a:incoming', {
      targetMindId,
      message: deliveryMessage,
      replyMessageId,
    });

    // 7. Deliver via ChatService — emit callback forwards events via IPC bus
    const returnImmediately = request.configuration?.returnImmediately !== false;
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
        console.error(`[MessageRouter] Delivery failed for ${targetMindId}:`, err);
      });
    }

    // 8. Return response
    return {
      message: {
        ...deliveryMessage,
        contextId,
      },
    };
  }
}
