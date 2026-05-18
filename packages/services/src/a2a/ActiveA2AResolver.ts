import type { AgentCard, SendMessageRequest, SendMessageResponse } from './types';
import type { AgentCardRegistry } from './AgentCardRegistry';

export type A2AResolverMode = 'local' | 'relay';

export interface A2AAgentResolver {
  getCard(identifier: string): AgentCard | null | Promise<AgentCard | null>;
  getCardByName(name: string): AgentCard | null | Promise<AgentCard | null>;
  getCards(): AgentCard[] | Promise<AgentCard[]>;
  canSendMessage?: () => boolean;
  sendMessage?: (request: SendMessageRequest) => Promise<SendMessageResponse>;
}

export interface RelayA2AResolverClient {
  getCard(identifier: string): Promise<AgentCard | null>;
  getCards(): Promise<AgentCard[]>;
  getCardByName?: (name: string) => Promise<AgentCard | null>;
  sendMessage?: (request: SendMessageRequest) => Promise<SendMessageResponse>;
}

export class ActiveA2AResolver implements A2AAgentResolver {
  private relayClient: RelayA2AResolverClient | null = null;

  constructor(private readonly localRegistry: AgentCardRegistry) {}

  getMode(): A2AResolverMode {
    return this.relayClient ? 'relay' : 'local';
  }

  useLocal(): void {
    this.relayClient = null;
  }

  useRelay(relayClient: RelayA2AResolverClient): void {
    this.relayClient = relayClient;
  }

  getCard(identifier: string): AgentCard | null | Promise<AgentCard | null> {
    return this.relayClient?.getCard(identifier) ?? this.localRegistry.getCard(identifier);
  }

  async getCardByName(name: string): Promise<AgentCard | null> {
    if (!this.relayClient) return this.localRegistry.getCardByName(name);
    if (this.relayClient.getCardByName) return this.relayClient.getCardByName(name);

    const matches = (await this.relayClient.getCards()).filter((card) => card.name === name);
    return matches.length === 1 ? matches[0] : null;
  }

  getCards(): AgentCard[] | Promise<AgentCard[]> {
    return this.relayClient?.getCards() ?? this.localRegistry.getCards();
  }

  canSendMessage(): boolean {
    return Boolean(this.relayClient?.sendMessage);
  }

  async sendMessage(request: SendMessageRequest): Promise<SendMessageResponse> {
    if (!this.relayClient?.sendMessage) {
      throw new Error('A2A relay transport is not connected');
    }
    return this.relayClient.sendMessage(request);
  }
}
