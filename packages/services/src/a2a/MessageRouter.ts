import type { AgentCard, AgentInterface, SendMessageRequest, SendMessageResponse, Message } from './types';
import { isLoopbackHttpUrl, type AgentCardRegistry } from './AgentCardRegistry';
import type { ChatService } from '../chat/ChatService';
import type { EventEmitter } from 'events';
import { generateMessageId, generateContextId, serializeMessageToXml } from './helpers';
import { Logger } from '../logger';

const log = Logger.create('MessageRouter');

const MAX_HOPS = 5;
const REMOTE_SEND_TIMEOUT_MS = 30_000;
const MAX_REMOTE_RESPONSE_BYTES = 1_000_000;

export interface MessageRouterOptions {
  fetch?: typeof fetch;
}

export interface SendMessageOptions {
  allowRemoteRecipients?: boolean;
}

export class MessageRouter {
  private contextHops = new Map<string, number>();
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly chatService: ChatService,
    private readonly registry: AgentCardRegistry,
    private readonly ipcEmitter: EventEmitter,
    options: MessageRouterOptions = {},
  ) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  async sendMessage(request: SendMessageRequest, options: SendMessageOptions = {}): Promise<SendMessageResponse> {
    // 1. Resolve recipient — try by mindId first, then by name
    const card = this.registry.getCard(request.recipient) ?? this.registry.getCardByName(request.recipient);
    if (!card) {
      throw new Error(`Unknown recipient: ${request.recipient}`);
    }
    if (!card.mindId) {
      if (options.allowRemoteRecipients === false) {
        throw new Error(`Unknown local recipient: ${request.recipient}`);
      }
      return this.sendRemoteMessage(card, request);
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
        log.error(`Delivery failed for ${targetMindId}:`, err);
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

  private async sendRemoteMessage(card: AgentCard, request: SendMessageRequest): Promise<SendMessageResponse> {
    const iface = findHttpJsonInterface(card);
    if (!iface) {
      throw new Error(`Agent ${card.name} does not expose a HTTP+JSON A2A interface`);
    }
    if (!isLoopbackHttpUrl(iface.url)) {
      throw new Error(`Refusing non-loopback A2A interface for ${card.name}: ${iface.url}`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REMOTE_SEND_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(resolveMessageSendUrl(iface.url), {
        method: 'POST',
        headers: {
          'content-type': 'application/a2a+json',
          accept: 'application/a2a+json, application/json',
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      const text = await response.text();
      if (text.length > MAX_REMOTE_RESPONSE_BYTES) {
        throw new Error(`A2A response from ${card.name} exceeded ${MAX_REMOTE_RESPONSE_BYTES} bytes`);
      }
      if (!response.ok) {
        throw new Error(`A2A send to ${card.name} failed with HTTP ${response.status}: ${text}`);
      }
      const body = text ? JSON.parse(text) as SendMessageResponse : {};
      if (!body.message && !body.task) {
        throw new Error(`A2A send to ${card.name} returned an invalid response`);
      }
      return body;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function findHttpJsonInterface(card: AgentCard): AgentInterface | null {
  return card.supportedInterfaces.find((iface) => iface.protocolBinding === 'HTTP+JSON') ?? null;
}

function resolveMessageSendUrl(baseUrl: string): string {
  if (baseUrl.endsWith('/message:send')) return baseUrl;
  return `${baseUrl.replace(/\/$/, '')}/message:send`;
}
