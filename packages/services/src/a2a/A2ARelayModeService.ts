import { ActiveA2AResolver } from './ActiveA2AResolver';
import { getErrorMessage } from '@chamber/shared/getErrorMessage';
import { AgentCardRegistry } from './AgentCardRegistry';
import { RelayA2ARegistryClient, type RelayA2ARegistryClientOptions } from './RelayA2ARegistryClient';
import type {
  A2ARelayDisposition,
  A2ARelayQueuedMessage,
  AgentCard,
  SendMessageRequest,
  SendMessageResponse,
} from './types';
import { Logger } from '../logger';

const log = Logger.create('A2ARelayModeService');
const RELAY_MAILBOX_BINDING_URI = 'https://github.com/ianphil/chamber/a2a/bindings/relay-mailbox/v1';

export interface A2ARelayRegistryClientPort {
  getCard(identifier: string): Promise<AgentCard | null>;
  getCardByName(name: string): Promise<AgentCard | null>;
  getCards(): Promise<AgentCard[]>;
  registerAgent(registration: { card: AgentCard; inboundAuth?: { scheme: 'bearer'; token: string } }): Promise<void>;
  unregisterAgent(identifier: string): Promise<void>;
  sendMessage(request: SendMessageRequest): Promise<SendMessageResponse>;
  pollMessages(request: { recipients: string[]; limit?: number }): Promise<A2ARelayQueuedMessage[]>;
  ackMessages(messageIds: string[]): Promise<number>;
  reportDisposition(id: string, digest: string, disposition: A2ARelayDisposition): Promise<void>;
}

export interface A2ARelayModeConnectOptions extends RelayA2ARegistryClientOptions {
  publishedBaseUrl?: string;
  inboundAuth?: { scheme: 'bearer'; token: string };
}

export interface A2ALocalDeliveryPort {
  deliverToLocalMind(targetMindId: string, request: SendMessageRequest): Promise<SendMessageResponse>;
}

export interface A2AInboundCustodyPort {
  receive(targetMindId: string, message: A2ARelayQueuedMessage): Promise<'delivered' | 'pending'>;
}

export class A2ARelayModeService {
  private relayClient: A2ARelayRegistryClientPort | null = null;
  private readonly publishedAgentNamesByMindId = new Map<string, string>();
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private polling = false;
  private lastPollError: string | null = null;
  private relayBaseUrl: string | null = null;

  constructor(
    private readonly localRegistry: AgentCardRegistry,
    private readonly activeResolver: ActiveA2AResolver,
    private readonly createClient: (options: RelayA2ARegistryClientOptions) => A2ARelayRegistryClientPort =
      (options) => new RelayA2ARegistryClient(options),
    private readonly localDelivery?: A2ALocalDeliveryPort,
    private readonly pollIntervalMs = 1_000,
    private readonly inboundCustody?: A2AInboundCustodyPort,
  ) {}

  isConnected(): boolean {
    return this.relayClient !== null;
  }

  getPublishedAgentCount(): number {
    return this.publishedAgentNamesByMindId.size;
  }

  async getRelayAgentCount(): Promise<number> {
    return this.relayClient ? (await this.relayClient.getCards()).length : 0;
  }

  async reportDisposition(
    id: string,
    digest: string,
    disposition: A2ARelayDisposition,
  ): Promise<void> {
    if (!this.relayClient) throw new Error('A2A relay transport is not connected');
    await this.relayClient.reportDisposition(id, digest, disposition);
  }

  getLastPollError(): string | null {
    return this.lastPollError;
  }

  async connect(options: A2ARelayModeConnectOptions): Promise<void> {
    if (this.relayClient) {
      await this.disconnect();
    }

    const client = this.createClient(options);
    const publishedCards = this.localRegistry.getCards().map((card) => publishCard(card, options.baseUrl));
    const registeredNames: string[] = [];

    try {
      for (const card of publishedCards) {
        await client.registerAgent({ card });
        registeredNames.push(card.name);
      }
    } catch (error) {
      await Promise.allSettled(registeredNames.map((name) => client.unregisterAgent(name)));
      throw error;
    }

    this.publishedAgentNamesByMindId.clear();
    for (const card of publishedCards) {
      if (card.mindId) this.publishedAgentNamesByMindId.set(card.mindId, card.name);
    }
    this.relayClient = client;
    this.relayBaseUrl = options.baseUrl;
    this.lastPollError = null;
    this.activeResolver.useRelay(client);
    this.schedulePoll();
  }

  async disconnect(): Promise<void> {
    const client = this.relayClient;
    const publishedNames = [...this.publishedAgentNamesByMindId.values()];
    this.relayClient = null;
    this.relayBaseUrl = null;
    this.lastPollError = null;
    this.stopPolling();
    this.publishedAgentNamesByMindId.clear();
    this.activeResolver.useLocal();

    if (!client || publishedNames.length === 0) return;

    const results = await Promise.allSettled(publishedNames.map((name) => client.unregisterAgent(name)));
    const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failed) throw failed.reason instanceof Error ? failed.reason : new Error(String(failed.reason));
  }

  async publishLocalCard(mindId: string): Promise<void> {
    if (!this.relayClient) return;

    const card = this.localRegistry.getCard(mindId);
    if (!card) throw new Error(`Cannot publish unknown local A2A mind: ${mindId}`);

    const publishedCard = publishCard(card, this.relayBaseUrl ?? 'http://127.0.0.1');
    await this.relayClient.registerAgent({ card: publishedCard });
    this.publishedAgentNamesByMindId.set(mindId, publishedCard.name);
  }

  async unpublishLocalCard(mindId: string): Promise<void> {
    if (!this.relayClient) return;

    const publishedName = this.publishedAgentNamesByMindId.get(mindId);
    if (!publishedName) return;

    await this.relayClient.unregisterAgent(publishedName);
    this.publishedAgentNamesByMindId.delete(mindId);
  }

  async pollOnce(): Promise<number> {
    if (!this.relayClient || (!this.localDelivery && !this.inboundCustody)) return 0;
    const recipients = getLocalRecipientIdentifiers(this.localRegistry.getCards());
    if (recipients.length === 0) return 0;

    const messages = await this.relayClient.pollMessages({ recipients });
    let deliveredCount = 0;
    let firstDeliveryError: unknown = null;
    for (const message of messages) {
      const targetMindId = findLocalMindId(this.localRegistry.getCards(), message.recipient);
      if (!targetMindId) continue;
      try {
        if (this.inboundCustody) {
          await this.inboundCustody.receive(targetMindId, message);
        } else {
          await this.localDelivery?.deliverToLocalMind(targetMindId, message.request);
        }
        await this.relayClient.ackMessages([message.id]);
        deliveredCount += 1;
      } catch (error) {
        firstDeliveryError ??= error;
      }
    }
    if (firstDeliveryError) {
      throw firstDeliveryError;
    }
    return deliveredCount;
  }

  private schedulePoll(delayMs = this.pollIntervalMs): void {
    this.stopPolling();
    if (!this.localDelivery && !this.inboundCustody) return;
    this.pollTimer = setTimeout(() => {
      void this.runPollLoop();
    }, delayMs);
  }

  private async runPollLoop(): Promise<void> {
    if (!this.relayClient || this.polling) return;
    this.polling = true;
    try {
      await this.pollOnce();
      this.lastPollError = null;
    } catch (error) {
      const message = getErrorMessage(error);
      this.lastPollError = message;
      log.warn(`A2A relay poll failed: ${message}`, error);
    } finally {
      this.polling = false;
      if (this.relayClient) this.schedulePoll();
    }
  }

  private stopPolling(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }
}

function publishCard(card: AgentCard, relayBaseUrl: string): AgentCard {
  return {
    ...card,
    supportedInterfaces: [{
      url: new URL('/message:send', relayBaseUrl).toString(),
      protocolBinding: RELAY_MAILBOX_BINDING_URI,
      protocolVersion: '1.0',
    }],
  };
}

function getLocalRecipientIdentifiers(cards: AgentCard[]): string[] {
  return [...new Set(cards.flatMap(getCardIdentifiers))];
}

function findLocalMindId(cards: AgentCard[], recipient: string): string | null {
  const match = cards.find((card) => getCardIdentifiers(card).includes(recipient));
  return match?.mindId ?? null;
}

function getCardIdentifiers(card: AgentCard): string[] {
  return [card.name, card.mindId, ...(card.aliases ?? [])]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}
