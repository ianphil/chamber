import { EventEmitter } from 'node:events';
import type {
  A2AInboundApprovalRequest,
  A2ARelayDisposition,
  A2ARelayQueuedMessage,
  SendMessageRequest,
  SendMessageResponse,
} from './types';
import { Logger } from '../logger';

const log = Logger.create('InboundA2AApprovalService');

export interface InboundA2AApprovalStore {
  create(request: A2AInboundApprovalRequest): boolean;
  get(id: string): A2AInboundApprovalRequest | null;
  listPending(): A2AInboundApprovalRequest[];
  claimPending(id: string, digest: string, decidedAt: string): A2AInboundApprovalRequest | null;
  markDelivered(id: string, decidedAt: string): A2AInboundApprovalRequest | null;
  markDeliveryFailed(id: string, error: string, decidedAt: string): A2AInboundApprovalRequest | null;
  declinePending(id: string, digest: string, decidedAt: string): A2AInboundApprovalRequest | null;
  expirePending(id: string, digest: string, decidedAt: string): A2AInboundApprovalRequest | null;
  close(): void;
}

export interface InboundA2ALocalDelivery {
  deliverToLocalMind(targetMindId: string, request: SendMessageRequest): Promise<SendMessageResponse>;
}

export interface InboundA2ATaskDelivery {
  deliverTaskToLocalMind(targetMindId: string, request: SendMessageRequest): Promise<unknown>;
}

export interface InboundA2ARelayDispositionReporter {
  reportDisposition(id: string, digest: string, disposition: A2ARelayDisposition): Promise<void>;
}

export interface InboundA2ANotifier {
  notify(alert: { title: string; body: string; onClick?: () => void }): void;
}

export interface InboundA2AApprovalServiceOptions {
  store: InboundA2AApprovalStore;
  delivery: InboundA2ALocalDelivery;
  taskDelivery?: InboundA2ATaskDelivery;
  relay: InboundA2ARelayDispositionReporter;
  notifier?: InboundA2ANotifier;
  now?: () => Date;
}

export class InboundA2AApprovalService extends EventEmitter {
  private readonly now: () => Date;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: InboundA2AApprovalServiceOptions) {
    super();
    this.now = options.now ?? (() => new Date());
  }

  listPending(): A2AInboundApprovalRequest[] {
    return this.options.store.listPending();
  }

  async receive(
    targetMindId: string,
    queuedMessage: A2ARelayQueuedMessage,
  ): Promise<'delivered' | 'pending'> {
    const envelope = queuedMessage.envelope;
    if (!envelope || envelope.version !== 1 || !envelope.digest.trim()) {
      throw new Error('A2A relay message did not include a valid verified envelope');
    }

    if (isSameVerifiedPrincipal(envelope.sender.identity, envelope.recipient.identity)) {
      const immediate = createApprovalRequest(
        targetMindId,
        queuedMessage,
        'approved',
        this.now().toISOString(),
      );
      const created = this.options.store.create(immediate);
      const existing = created ? immediate : this.options.store.get(queuedMessage.id);
      if (existing?.digest !== envelope.digest) {
        throw new Error(`A2A relay message ID was reused with different content: ${queuedMessage.id}`);
      }
      if (existing?.state === 'delivered') {
        await this.options.relay.reportDisposition(queuedMessage.id, envelope.digest, 'delivered');
        return 'delivered';
      }

      try {
        await this.deliver(immediate);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.options.store.markDeliveryFailed(
          queuedMessage.id,
          message,
          this.now().toISOString(),
        );
        await this.options.relay.reportDisposition(
          queuedMessage.id,
          envelope.digest,
          'delivery_failed',
        );
        throw error;
      }
      this.options.store.markDelivered(queuedMessage.id, this.now().toISOString());
      await this.options.relay.reportDisposition(queuedMessage.id, envelope.digest, 'delivered');
      return 'delivered';
    }

    const pending = createApprovalRequest(targetMindId, queuedMessage, 'pending');
    const created = this.options.store.create(pending);
    const existing = created ? pending : this.options.store.get(queuedMessage.id);
    if (existing?.digest !== envelope.digest) {
      throw new Error(`A2A relay message ID was reused with different content: ${queuedMessage.id}`);
    }
    if (created) {
      this.emit('changed', this.listPending());
      this.options.notifier?.notify({
        title: 'External agent request',
        body: `${envelope.sender.agent?.name ?? 'An external agent'} wants to contact ${envelope.recipient.agent.name}.`,
        onClick: () => this.emit('review-requested', pending.id),
      });
    }
    return 'pending';
  }

  async approve(id: string, digest: string): Promise<A2AInboundApprovalRequest> {
    const decidedAt = this.now().toISOString();
    const request = this.options.store.claimPending(id, digest, decidedAt);
    if (!request) {
      throw new Error('Pending A2A request was not found or no longer matches');
    }
    this.emit('changed', this.listPending());

    try {
      await this.deliver(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.options.store.markDeliveryFailed(id, message, decidedAt);
      await this.options.relay.reportDisposition(id, digest, 'delivery_failed');
      this.emit('changed', this.listPending());
      throw error;
    }
    const delivered = this.options.store.markDelivered(id, decidedAt);
    if (!delivered) throw new Error(`Approved A2A request disappeared before delivery: ${id}`);
    await this.options.relay.reportDisposition(id, digest, 'delivered');
    this.emit('changed', this.listPending());
    return delivered;
  }

  async decline(id: string, digest: string): Promise<A2AInboundApprovalRequest> {
    const decidedAt = this.now().toISOString();
    const request = this.options.store.declinePending(id, digest, decidedAt);
    if (!request) {
      throw new Error('Pending A2A request was not found or no longer matches');
    }
    await this.options.relay.reportDisposition(id, digest, 'declined');
    this.emit('changed', this.listPending());
    return request;
  }

  async expirePending(): Promise<number> {
    const now = this.now();
    const decidedAt = now.toISOString();
    const expired = this.listPending().filter((request) => Date.parse(request.expiresAt) <= now.getTime());
    let expiredCount = 0;
    for (const request of expired) {
      const result = this.options.store.expirePending(request.id, request.digest, decidedAt);
      if (!result) continue;
      await this.options.relay.reportDisposition(request.id, request.digest, 'expired');
      expiredCount += 1;
    }
    if (expiredCount > 0) this.emit('changed', this.listPending());
    return expiredCount;
  }

  startExpirySweep(intervalMs = 60_000): void {
    this.stopExpirySweep();
    const run = async () => {
      try {
        await this.expirePending();
      } catch (error) {
        log.warn('Failed to expire pending inbound A2A requests:', error);
      } finally {
        this.expiryTimer = setTimeout(() => {
          void run();
        }, intervalMs);
      }
    };
    void run();
  }

  stopExpirySweep(): void {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
  }

  close(): void {
    this.stopExpirySweep();
    this.options.store.close();
    this.removeAllListeners();
  }

  private async deliver(request: A2AInboundApprovalRequest): Promise<void> {
    if (request.kind === 'task') {
      if (!this.options.taskDelivery) {
        throw new Error('Remote A2A task delivery is unavailable');
      }
      await this.options.taskDelivery.deliverTaskToLocalMind(request.targetMindId, request.request);
      return;
    }
    await this.options.delivery.deliverToLocalMind(request.targetMindId, request.request);
  }
}

function createApprovalRequest(
  targetMindId: string,
  queuedMessage: A2ARelayQueuedMessage,
  state: 'pending' | 'approved',
  decidedAt?: string,
): A2AInboundApprovalRequest {
  const envelope = queuedMessage.envelope;
  if (!envelope) throw new Error('A2A relay message did not include a verified envelope');
  return {
    id: queuedMessage.id,
    digest: envelope.digest,
    kind: envelope.kind,
    targetMindId,
    request: queuedMessage.request,
    sender: envelope.sender,
    recipient: envelope.recipient,
    preview: getRequestPreview(queuedMessage.request),
    state,
    receivedAt: queuedMessage.enqueuedAt,
    expiresAt: envelope.expiresAt,
    ...(state === 'approved' && decidedAt ? { decidedAt } : {}),
  };
}

function isSameVerifiedPrincipal(
  sender: { authentication: 'entra' | 'static'; principalId?: string },
  recipient: { authentication: 'entra' | 'static'; principalId?: string },
): boolean {
  return sender.authentication === 'entra'
    && recipient.authentication === 'entra'
    && typeof sender.principalId === 'string'
    && sender.principalId.length > 0
    && sender.principalId === recipient.principalId;
}

function getRequestPreview(request: SendMessageRequest): string {
  const text = request.message.parts
    .map((part) => part.text)
    .filter((part): part is string => typeof part === 'string')
    .join(' ')
    .split('')
    .map((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127 ? ' ' : character;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length <= 160 ? text : `${text.slice(0, 157)}...`;
}
