import { describe, expect, it, vi } from 'vitest';
import type {
  A2AInboundApprovalRequest,
  A2ARelayIdentity,
  A2ARelayQueuedMessage,
} from './types';
import {
  InboundA2AApprovalService,
  type InboundA2AApprovalStore,
} from './InboundA2AApprovalService';

describe('InboundA2AApprovalService', () => {
  it('delivers same-principal relay messages without creating an approval', async () => {
    const fixture = createFixture();

    await expect(fixture.service.receive('mind-a', makeQueuedMessage({
      senderPrincipalId: 'principal-a',
      recipientPrincipalId: 'principal-a',
    }))).resolves.toBe('delivered');

    expect(fixture.delivery.deliverToLocalMind).toHaveBeenCalledTimes(1);
    expect(fixture.store.create).toHaveBeenCalledWith(expect.objectContaining({ state: 'approved' }));
    expect(fixture.relay.reportDisposition).toHaveBeenCalledWith(
      'relay-msg-1',
      'digest-1',
      'delivered',
    );
  });

  it('persists a different-principal message without delivering it', async () => {
    const fixture = createFixture();
    const message = makeQueuedMessage({
      senderPrincipalId: 'principal-b',
      recipientPrincipalId: 'principal-a',
    });

    await expect(fixture.service.receive('mind-a', message)).resolves.toBe('pending');

    expect(fixture.store.create).toHaveBeenCalledWith(expect.objectContaining({
      id: 'relay-msg-1',
      digest: 'digest-1',
      targetMindId: 'mind-a',
      state: 'pending',
    }));
    expect(fixture.delivery.deliverToLocalMind).not.toHaveBeenCalled();
    expect(fixture.notifier.notify).toHaveBeenCalledTimes(1);
  });

  it('retries relay disposition without redelivering a same-principal message already recorded as delivered', async () => {
    const delivered = makeApprovalRequest({ state: 'delivered' });
    const fixture = createFixture({
      createPendingResult: false,
      request: delivered,
    });

    await fixture.service.receive('mind-a', makeQueuedMessage({
      senderPrincipalId: 'principal-a',
      recipientPrincipalId: 'principal-a',
    }));

    expect(fixture.delivery.deliverToLocalMind).not.toHaveBeenCalled();
    expect(fixture.relay.reportDisposition).toHaveBeenCalledWith(
      'relay-msg-1',
      'digest-1',
      'delivered',
    );
  });

  it('fails closed when the relay envelope has no verified Entra principal', async () => {
    const fixture = createFixture();

    await fixture.service.receive('mind-a', makeQueuedMessage({
      senderAuthentication: 'static',
      recipientPrincipalId: 'principal-a',
    }));

    expect(fixture.store.create).toHaveBeenCalledTimes(1);
    expect(fixture.delivery.deliverToLocalMind).not.toHaveBeenCalled();
  });

  it('does not notify again when the relay redelivers an existing pending request', async () => {
    const fixture = createFixture({
      createPendingResult: false,
      request: makeApprovalRequest(),
    });

    await fixture.service.receive('mind-a', makeQueuedMessage({
      senderPrincipalId: 'principal-b',
      recipientPrincipalId: 'principal-a',
    }));

    expect(fixture.notifier.notify).not.toHaveBeenCalled();
  });

  it('approves one immutable pending request and delivers it exactly once', async () => {
    const fixture = createFixture({
      request: makeApprovalRequest(),
    });

    await expect(fixture.service.approve('relay-msg-1', 'digest-1')).resolves.toMatchObject({
      state: 'delivered',
    });

    expect(fixture.store.claimPending).toHaveBeenCalledWith('relay-msg-1', 'digest-1', fixture.now);
    expect(fixture.delivery.deliverToLocalMind).toHaveBeenCalledTimes(1);
    expect(fixture.store.markDelivered).toHaveBeenCalledWith('relay-msg-1', fixture.now);
    expect(fixture.relay.reportDisposition).toHaveBeenCalledWith(
      'relay-msg-1',
      'digest-1',
      'delivered',
    );
  });

  it('keeps a locally delivered request terminal when relay disposition reporting fails', async () => {
    const fixture = createFixture({ request: makeApprovalRequest() });
    fixture.relay.reportDisposition.mockRejectedValueOnce(new Error('relay unavailable'));

    await expect(fixture.service.approve('relay-msg-1', 'digest-1'))
      .rejects.toThrow('relay unavailable');

    expect(fixture.store.markDelivered).toHaveBeenCalledWith('relay-msg-1', fixture.now);
    expect(fixture.store.markDeliveryFailed).not.toHaveBeenCalled();
  });

  it('fails closed instead of treating a remote task as a chat message', async () => {
    const fixture = createFixture({
      request: makeApprovalRequest({ kind: 'task' }),
    });

    await expect(fixture.service.approve('relay-msg-1', 'digest-1'))
      .rejects.toThrow('Remote A2A task delivery is unavailable');

    expect(fixture.delivery.deliverToLocalMind).not.toHaveBeenCalled();
    expect(fixture.store.markDeliveryFailed).toHaveBeenCalled();
    expect(fixture.relay.reportDisposition).toHaveBeenCalledWith(
      'relay-msg-1',
      'digest-1',
      'delivery_failed',
    );
  });

  it('rejects an approval whose digest does not match the pending envelope', async () => {
    const fixture = createFixture({ request: makeApprovalRequest() });
    fixture.store.claimPending.mockReturnValue(null);

    await expect(fixture.service.approve('relay-msg-1', 'different-digest'))
      .rejects.toThrow('Pending A2A request was not found or no longer matches');

    expect(fixture.delivery.deliverToLocalMind).not.toHaveBeenCalled();
  });

  it('declines a pending request without delivering it', async () => {
    const fixture = createFixture({ request: makeApprovalRequest() });

    await expect(fixture.service.decline('relay-msg-1', 'digest-1')).resolves.toMatchObject({
      state: 'declined',
    });

    expect(fixture.delivery.deliverToLocalMind).not.toHaveBeenCalled();
    expect(fixture.relay.reportDisposition).toHaveBeenCalledWith(
      'relay-msg-1',
      'digest-1',
      'declined',
    );
  });

  it('expires pending requests and reports a generic terminal disposition', async () => {
    const request = makeApprovalRequest({ expiresAt: '2026-07-12T09:00:00.000Z' });
    const fixture = createFixture({ request, pending: [request] });

    await expect(fixture.service.expirePending()).resolves.toBe(1);

    expect(fixture.store.expirePending).toHaveBeenCalledWith('relay-msg-1', 'digest-1', fixture.now);
    expect(fixture.relay.reportDisposition).toHaveBeenCalledWith(
      'relay-msg-1',
      'digest-1',
      'expired',
    );
  });
});

function createFixture(options: {
  createPendingResult?: boolean;
  request?: A2AInboundApprovalRequest;
  pending?: A2AInboundApprovalRequest[];
} = {}) {
  const now = '2026-07-12T10:00:00.000Z';
  const request = options.request;
  const store = {
    create: vi.fn(() => options.createPendingResult ?? true),
    get: vi.fn(() => request ?? null),
    listPending: vi.fn(() => options.pending ?? []),
    claimPending: vi.fn((): A2AInboundApprovalRequest | null =>
      request ? { ...request, state: 'approved', decidedAt: now } : null),
    markDelivered: vi.fn((): A2AInboundApprovalRequest | null =>
      request ? { ...request, state: 'delivered', decidedAt: now } : null),
    markDeliveryFailed: vi.fn((): A2AInboundApprovalRequest | null =>
      request ? { ...request, state: 'delivery_failed', decidedAt: now } : null),
    declinePending: vi.fn((): A2AInboundApprovalRequest | null =>
      request ? { ...request, state: 'declined', decidedAt: now } : null),
    expirePending: vi.fn((): A2AInboundApprovalRequest | null =>
      request ? { ...request, state: 'expired', decidedAt: now } : null),
    close: vi.fn(),
  } satisfies InboundA2AApprovalStore;
  const delivery = {
    deliverToLocalMind: vi.fn(async (_mindId, queuedRequest) => ({ message: queuedRequest.message })),
  };
  const relay = {
    reportDisposition: vi.fn(async () => undefined),
  };
  const notifier = {
    notify: vi.fn(),
  };
  return {
    now,
    store,
    delivery,
    relay,
    notifier,
    service: new InboundA2AApprovalService({
      store,
      delivery,
      relay,
      notifier,
      now: () => new Date(now),
    }),
  };
}

function makeQueuedMessage(options: {
  senderAuthentication?: A2ARelayIdentity['authentication'];
  senderPrincipalId?: string;
  recipientPrincipalId?: string;
}): A2ARelayQueuedMessage {
  return {
    id: 'relay-msg-1',
    recipient: 'Agent A',
    request: {
      recipient: 'Agent A',
      message: {
        messageId: 'msg-1',
        role: 'ROLE_USER',
        parts: [{ text: 'Please inspect the deployment.' }],
      },
    },
    enqueuedAt: '2026-07-12T09:59:00.000Z',
    attempts: 1,
    envelope: {
      version: 1,
      kind: 'message',
      digest: 'digest-1',
      expiresAt: '2026-07-13T09:59:00.000Z',
      sender: {
        identity: {
          authentication: options.senderAuthentication ?? 'entra',
          principalId: options.senderPrincipalId,
        },
        agent: { name: 'Remote Agent', identifier: 'remote-agent' },
      },
      recipient: {
        identity: {
          authentication: 'entra',
          principalId: options.recipientPrincipalId,
        },
        agent: { name: 'Agent A', identifier: 'mind-a' },
      },
    },
  };
}

function makeApprovalRequest(
  overrides: Partial<A2AInboundApprovalRequest> = {},
): A2AInboundApprovalRequest {
  return {
    id: 'relay-msg-1',
    digest: 'digest-1',
    kind: 'message',
    targetMindId: 'mind-a',
    request: {
      recipient: 'Agent A',
      message: {
        messageId: 'msg-1',
        role: 'ROLE_USER',
        parts: [{ text: 'Please inspect the deployment.' }],
      },
    },
    sender: {
      identity: { authentication: 'entra', principalId: 'principal-b' },
      agent: { name: 'Remote Agent', identifier: 'remote-agent' },
    },
    recipient: {
      identity: { authentication: 'entra', principalId: 'principal-a' },
      agent: { name: 'Agent A', identifier: 'mind-a' },
    },
    preview: 'Please inspect the deployment.',
    state: 'pending',
    receivedAt: '2026-07-12T09:59:00.000Z',
    expiresAt: '2026-07-13T09:59:00.000Z',
    ...overrides,
  };
}
