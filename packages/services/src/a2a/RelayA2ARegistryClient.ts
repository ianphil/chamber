import type {
  AgentCard,
  A2ARelayAckResponse,
  A2ARelayPollRequest,
  A2ARelayPollResponse,
  A2ARelayQueuedMessage,
  SendMessageRequest,
  SendMessageResponse,
} from './types';

const RELAY_REQUEST_TIMEOUT_MS = 30_000;
const MAX_RELAY_RESPONSE_BYTES = 1_000_000;

export interface RelayA2ARegistryClientOptions {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
}

export interface RelayAgentRegistration {
  card: AgentCard;
  inboundAuth?: { scheme: 'bearer'; token: string };
}

export class RelayA2ARegistryClient {
  private readonly baseUrl: URL;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor({ baseUrl, token, fetchImpl = fetch }: RelayA2ARegistryClientOptions) {
    this.baseUrl = normalizeRelayBaseUrl(baseUrl);
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  async getCards(): Promise<AgentCard[]> {
    const body = await this.requestJson<{ agents?: unknown }>('/api/a2a/agents');
    return Array.isArray(body.agents) ? body.agents.filter(isAgentCard) : [];
  }

  async getCard(identifier: string): Promise<AgentCard | null> {
    const response = await this.request(`/api/a2a/agents/${encodeURIComponent(identifier)}/card`);
    if (response.status === 404) return null;
    const body = await parseRelayJson(response);
    if (!response.ok) throw new Error(`A2A relay card lookup failed with HTTP ${response.status}`);
    if (!isAgentCard(body)) throw new Error('A2A relay returned an invalid agent card');
    return body;
  }

  async getCardByName(name: string): Promise<AgentCard | null> {
    const matches = (await this.getCards()).filter((card) => card.name === name);
    return matches.length === 1 ? matches[0] : null;
  }

  async registerAgent({ card, inboundAuth }: RelayAgentRegistration): Promise<void> {
    await this.requestJson('/api/a2a/agents', {
      method: 'POST',
      body: JSON.stringify({ card, inboundAuth }),
    });
  }

  async unregisterAgent(identifier: string): Promise<void> {
    await this.requestJson(`/api/a2a/agents/${encodeURIComponent(identifier)}`, { method: 'DELETE' });
  }

  async sendMessage(request: SendMessageRequest): Promise<SendMessageResponse> {
    const body = await this.requestJson<unknown>('/api/a2a/message:send', {
      method: 'POST',
      body: JSON.stringify(request),
    });
    if (!isSendMessageResponse(body)) throw new Error('A2A relay returned an invalid send response');
    return body;
  }

  async pollMessages(request: A2ARelayPollRequest): Promise<A2ARelayQueuedMessage[]> {
    const body = await this.requestJson<unknown>('/api/a2a/messages:poll', {
      method: 'POST',
      body: JSON.stringify(request),
    });
    if (!isPollResponse(body)) throw new Error('A2A relay returned an invalid poll response');
    return body.messages;
  }

  async ackMessages(messageIds: string[]): Promise<number> {
    const body = await this.requestJson<unknown>('/api/a2a/messages:ack', {
      method: 'POST',
      body: JSON.stringify({ messageIds }),
    });
    if (!isAckResponse(body)) throw new Error('A2A relay returned an invalid ack response');
    return body.acknowledged;
  }

  private async requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.request(path, init);
    const body = await parseRelayJson(response);
    if (!response.ok) throw new Error(getRelayErrorMessage(body, response.status));
    return body as T;
  }

  private request(path: string, init: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RELAY_REQUEST_TIMEOUT_MS);
    return this.fetchImpl(new URL(path, this.baseUrl), {
      ...init,
      headers: {
        authorization: `Bearer ${this.token}`,
        'A2A-Version': '1.0',
        accept: 'application/a2a+json, application/json',
        'content-type': 'application/json',
        ...init.headers,
      },
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));
  }
}

function normalizeRelayBaseUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('A2A relay URL must be an HTTP loopback URL');
  }
  return url;
}

async function parseRelayJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length > MAX_RELAY_RESPONSE_BYTES) {
    throw new Error(`A2A relay response exceeded ${MAX_RELAY_RESPONSE_BYTES} bytes`);
  }
  return text ? JSON.parse(text) : {};
}

function getRelayErrorMessage(body: unknown, status: number): string {
  if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
    return body.error;
  }
  return `A2A relay request failed with HTTP ${status}`;
}

function isAgentCard(value: unknown): value is AgentCard {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as AgentCard).name === 'string' &&
    typeof (value as AgentCard).description === 'string' &&
    typeof (value as AgentCard).version === 'string' &&
    Array.isArray((value as AgentCard).supportedInterfaces),
  );
}

function isSendMessageResponse(value: unknown): value is SendMessageResponse {
  return Boolean(
    value &&
    typeof value === 'object' &&
    ('message' in value || 'task' in value || 'queued' in value),
  );
}

function isPollResponse(value: unknown): value is A2ARelayPollResponse {
  return Boolean(
    value &&
    typeof value === 'object' &&
    Array.isArray((value as A2ARelayPollResponse).messages) &&
    (value as A2ARelayPollResponse).messages.every(isQueuedMessage),
  );
}

function isQueuedMessage(value: unknown): value is A2ARelayQueuedMessage {
  const message = value as A2ARelayQueuedMessage;
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof message.id === 'string' &&
    typeof message.recipient === 'string' &&
    typeof message.enqueuedAt === 'string' &&
    typeof message.attempts === 'number' &&
    message.request &&
    typeof message.request === 'object' &&
    typeof message.request.recipient === 'string',
  );
}

function isAckResponse(value: unknown): value is A2ARelayAckResponse {
  return Boolean(
    value &&
    typeof value === 'object' &&
    Number.isInteger((value as A2ARelayAckResponse).acknowledged),
  );
}
