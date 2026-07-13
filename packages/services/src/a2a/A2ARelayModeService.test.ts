import { beforeEach, describe, expect, it, vi } from 'vitest';
import { A2ARelayModeService, type A2ARelayRegistryClientPort } from './A2ARelayModeService';
import { ActiveA2AResolver } from './ActiveA2AResolver';
import { AgentCardRegistry } from './AgentCardRegistry';
import type { AgentCard } from './types';

describe('A2ARelayModeService', () => {
  let localRegistry: AgentCardRegistry;
  let activeResolver: ActiveA2AResolver;
  let relayClient: {
    getCard: ReturnType<typeof vi.fn>;
    getCards: ReturnType<typeof vi.fn>;
    getCardByName: ReturnType<typeof vi.fn>;
    registerAgent: ReturnType<typeof vi.fn>;
    unregisterAgent: ReturnType<typeof vi.fn>;
    sendMessage: ReturnType<typeof vi.fn>;
    pollMessages: ReturnType<typeof vi.fn>;
    ackMessages: ReturnType<typeof vi.fn>;
    reportDisposition: ReturnType<typeof vi.fn>;
  };
  let service: A2ARelayModeService;

  beforeEach(() => {
    localRegistry = new AgentCardRegistry();
    activeResolver = new ActiveA2AResolver(localRegistry);
    relayClient = {
      getCard: vi.fn(async () => null),
      getCards: vi.fn(async () => []),
      getCardByName: vi.fn(async () => null),
      registerAgent: vi.fn(async () => undefined),
      unregisterAgent: vi.fn(async () => undefined),
      sendMessage: vi.fn(async (request) => ({ message: request.message })),
      pollMessages: vi.fn(async () => []),
      ackMessages: vi.fn(async (messageIds) => messageIds.length),
      reportDisposition: vi.fn(async () => undefined),
    };
    service = new A2ARelayModeService(localRegistry, activeResolver, () => relayClient as unknown as A2ARelayRegistryClientPort);
  });

  it('publishes local cards before switching the active resolver to relay mode', async () => {
    vi.spyOn(localRegistry, 'getCards').mockReturnValue([makeCard('mind-a', 'Agent A')]);

    await service.connect({
      baseUrl: 'http://127.0.0.1:4100',
      authProvider: makeAuthProvider(),
      publishedBaseUrl: 'http://127.0.0.1:4200',
      inboundAuth: { scheme: 'bearer', token: 'inbound-secret' },
    });

    expect(relayClient.registerAgent).toHaveBeenCalledWith({
      card: expect.objectContaining({
        mindId: 'mind-a',
        supportedInterfaces: [{
          url: 'http://127.0.0.1:4100/message:send',
          protocolBinding: 'https://github.com/ianphil/chamber/a2a/bindings/relay-mailbox/v1',
          protocolVersion: '1.0',
        }],
      }),
    });
    expect(activeResolver.getMode()).toBe('relay');
    expect(service.isConnected()).toBe(true);
  });

  it('does not switch to relay mode when publication fails', async () => {
    vi.spyOn(localRegistry, 'getCards').mockReturnValue([makeCard('mind-a', 'Agent A')]);
    relayClient.registerAgent.mockRejectedValueOnce(new Error('relay unavailable'));

    await expect(service.connect({
      baseUrl: 'http://127.0.0.1:4100',
      authProvider: makeAuthProvider(),
      publishedBaseUrl: 'http://127.0.0.1:4200',
    })).rejects.toThrow('relay unavailable');

    expect(activeResolver.getMode()).toBe('local');
    expect(service.isConnected()).toBe(false);
  });

  it('unregisters already published cards when connect fails partway through', async () => {
    vi.spyOn(localRegistry, 'getCards').mockReturnValue([
      makeCard('mind-a', 'Agent A'),
      makeCard('mind-b', 'Agent B'),
    ]);
    relayClient.registerAgent
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('relay unavailable'));

    await expect(service.connect({
      baseUrl: 'http://127.0.0.1:4100',
      authProvider: makeAuthProvider(),
      publishedBaseUrl: 'http://127.0.0.1:4200',
    })).rejects.toThrow('relay unavailable');

    expect(relayClient.unregisterAgent).toHaveBeenCalledWith('Agent A');
    expect(activeResolver.getMode()).toBe('local');
  });

  it('returns to local mode and unregisters published cards on disconnect', async () => {
    vi.spyOn(localRegistry, 'getCards').mockReturnValue([makeCard('mind-a', 'Agent A')]);
    await service.connect({
      baseUrl: 'http://127.0.0.1:4100',
      authProvider: makeAuthProvider(),
      publishedBaseUrl: 'http://127.0.0.1:4200',
    });

    await service.disconnect();

    expect(relayClient.unregisterAgent).toHaveBeenCalledWith('Agent A');
    expect(activeResolver.getMode()).toBe('local');
    expect(service.isConnected()).toBe(false);
  });

  it('publishes and unpublishes cards loaded while connected', async () => {
    vi.spyOn(localRegistry, 'getCards').mockReturnValue([]);
    vi.spyOn(localRegistry, 'getCard').mockReturnValue(makeCard('mind-b', 'Agent B'));
    await service.connect({
      baseUrl: 'http://127.0.0.1:4100',
      authProvider: makeAuthProvider(),
      publishedBaseUrl: 'http://127.0.0.1:4200',
    });

    await service.publishLocalCard('mind-b');
    await service.unpublishLocalCard('mind-b');

    expect(relayClient.registerAgent).toHaveBeenCalledWith({
      card: expect.objectContaining({ name: 'Agent B' }),
    });
    expect(relayClient.unregisterAgent).toHaveBeenCalledWith('Agent B');
  });

  it('polls relay messages, delivers them locally, and acks after delivery', async () => {
    vi.spyOn(localRegistry, 'getCards').mockReturnValue([makeCard('mind-a', 'Agent A')]);
    const localDelivery = {
      deliverToLocalMind: vi.fn(async (_mindId, request) => ({ message: request.message })),
    };
    relayClient.pollMessages.mockResolvedValueOnce([{
      id: 'relay-msg-1',
      recipient: 'Agent A',
      request: {
        recipient: 'Agent A',
        message: { messageId: 'msg-1', role: 'ROLE_USER', parts: [{ text: 'hello' }] },
      },
      enqueuedAt: '2026-01-01T00:00:00.000Z',
      attempts: 1,
    }]);
    service = new A2ARelayModeService(
      localRegistry,
      activeResolver,
      () => relayClient as unknown as A2ARelayRegistryClientPort,
      localDelivery,
      60_000,
    );
    await service.connect({
      baseUrl: 'http://127.0.0.1:4100',
      authProvider: makeAuthProvider(),
    });

    await service.pollOnce();

    expect(relayClient.pollMessages).toHaveBeenCalledWith({ recipients: ['Agent A', 'mind-a'] });
    expect(localDelivery.deliverToLocalMind).toHaveBeenCalledWith('mind-a', {
      recipient: 'Agent A',
      message: { messageId: 'msg-1', role: 'ROLE_USER', parts: [{ text: 'hello' }] },
    });
    expect(relayClient.ackMessages).toHaveBeenCalledWith(['relay-msg-1']);
    await service.disconnect();
  });

  it('persists external relay messages through inbound custody before acknowledging them', async () => {
    vi.spyOn(localRegistry, 'getCards').mockReturnValue([makeCard('mind-a', 'Agent A')]);
    const localDelivery = {
      deliverToLocalMind: vi.fn(async (_mindId, request) => ({ message: request.message })),
    };
    const inboundCustody = {
      receive: vi.fn(async () => 'pending' as const),
    };
    relayClient.pollMessages.mockResolvedValueOnce([{
      id: 'relay-msg-1',
      recipient: 'Agent A',
      request: {
        recipient: 'Agent A',
        message: { messageId: 'msg-1', role: 'ROLE_USER', parts: [{ text: 'hello' }] },
      },
      enqueuedAt: '2026-01-01T00:00:00.000Z',
      attempts: 1,
    }]);
    service = new A2ARelayModeService(
      localRegistry,
      activeResolver,
      () => relayClient as unknown as A2ARelayRegistryClientPort,
      localDelivery,
      60_000,
      inboundCustody,
    );
    await service.connect({
      baseUrl: 'http://127.0.0.1:4100',
      authProvider: makeAuthProvider(),
    });

    await service.pollOnce();

    expect(inboundCustody.receive).toHaveBeenCalledWith('mind-a', expect.objectContaining({
      id: 'relay-msg-1',
    }));
    expect(localDelivery.deliverToLocalMind).not.toHaveBeenCalled();
    expect(relayClient.ackMessages).toHaveBeenCalledWith(['relay-msg-1']);
    await service.disconnect();
  });

  it('routes a queued message by the relay-resolved recipient', async () => {
    vi.spyOn(localRegistry, 'getCards').mockReturnValue([makeCard('mind-a', 'Agent A')]);
    const inboundCustody = {
      receive: vi.fn(async () => 'pending' as const),
    };
    relayClient.pollMessages.mockResolvedValueOnce([{
      id: 'relay-msg-1',
      recipient: 'Agent A',
      request: {
        recipient: 'stale-sender-address',
        message: { messageId: 'msg-1', role: 'ROLE_USER', parts: [{ text: 'hello' }] },
      },
      enqueuedAt: new Date().toISOString(),
      attempts: 1,
    }]);
    service = new A2ARelayModeService(
      localRegistry,
      activeResolver,
      () => relayClient as unknown as A2ARelayRegistryClientPort,
      undefined,
      1_000,
      inboundCustody,
    );
    await service.connect({
      baseUrl: 'https://relay.example',
      authProvider: makeAuthProvider(),
    });

    await service.pollOnce();

    expect(inboundCustody.receive).toHaveBeenCalledWith('mind-a', expect.objectContaining({
      id: 'relay-msg-1',
    }));
    expect(relayClient.ackMessages).toHaveBeenCalledWith(['relay-msg-1']);
    await service.disconnect();
  });

  it('acks successfully delivered messages even when a later message fails', async () => {
    vi.spyOn(localRegistry, 'getCards').mockReturnValue([makeCard('mind-a', 'Agent A')]);
    const localDelivery = {
      deliverToLocalMind: vi.fn()
        .mockResolvedValueOnce({ message: { messageId: 'msg-1', role: 'ROLE_USER', parts: [{ text: 'hello' }] } })
        .mockRejectedValueOnce(new Error('delivery failed')),
    };
    relayClient.pollMessages.mockResolvedValueOnce([
      {
        id: 'relay-msg-1',
        recipient: 'Agent A',
        request: {
          recipient: 'Agent A',
          message: { messageId: 'msg-1', role: 'ROLE_USER', parts: [{ text: 'hello' }] },
        },
        enqueuedAt: '2026-01-01T00:00:00.000Z',
        attempts: 1,
      },
      {
        id: 'relay-msg-2',
        recipient: 'Agent A',
        request: {
          recipient: 'Agent A',
          message: { messageId: 'msg-2', role: 'ROLE_USER', parts: [{ text: 'again' }] },
        },
        enqueuedAt: '2026-01-01T00:00:00.000Z',
        attempts: 1,
      },
    ]);
    service = new A2ARelayModeService(
      localRegistry,
      activeResolver,
      () => relayClient as unknown as A2ARelayRegistryClientPort,
      localDelivery,
      60_000,
    );
    await service.connect({
      baseUrl: 'http://127.0.0.1:4100',
      authProvider: makeAuthProvider(),
    });

    await expect(service.pollOnce()).rejects.toThrow('delivery failed');

    expect(relayClient.ackMessages).toHaveBeenCalledWith(['relay-msg-1']);
    expect(relayClient.ackMessages).not.toHaveBeenCalledWith(['relay-msg-2']);
    await service.disconnect();
  });

  it('does not ack polled messages that cannot be mapped to a local mind', async () => {
    vi.spyOn(localRegistry, 'getCards').mockReturnValue([makeCard('mind-a', 'Agent A')]);
    const localDelivery = {
      deliverToLocalMind: vi.fn(async (_mindId, request) => ({ message: request.message })),
    };
    relayClient.pollMessages.mockResolvedValueOnce([{
      id: 'relay-msg-1',
      recipient: 'Agent B',
      request: {
        recipient: 'Agent B',
        message: { messageId: 'msg-1', role: 'ROLE_USER', parts: [{ text: 'hello' }] },
      },
      enqueuedAt: '2026-01-01T00:00:00.000Z',
      attempts: 1,
    }]);
    service = new A2ARelayModeService(
      localRegistry,
      activeResolver,
      () => relayClient as unknown as A2ARelayRegistryClientPort,
      localDelivery,
      60_000,
    );
    await service.connect({
      baseUrl: 'http://127.0.0.1:4100',
      authProvider: makeAuthProvider(),
    });

    await service.pollOnce();

    expect(localDelivery.deliverToLocalMind).not.toHaveBeenCalled();
    expect(relayClient.ackMessages).not.toHaveBeenCalled();
    await service.disconnect();
  });

  it('disconnects an existing relay before reconnecting', async () => {
    vi.spyOn(localRegistry, 'getCards').mockReturnValue([makeCard('mind-a', 'Agent A')]);
    await service.connect({
      baseUrl: 'http://127.0.0.1:4100',
      authProvider: makeAuthProvider(),
    });

    await service.connect({
      baseUrl: 'http://127.0.0.1:4101',
      authProvider: makeAuthProvider('Bearer relay-secret-2'),
    });

    expect(relayClient.unregisterAgent).toHaveBeenCalledWith('Agent A');
    expect(relayClient.registerAgent).toHaveBeenCalledTimes(2);
    expect(service.isConnected()).toBe(true);
  });

  it('records poll errors without rejecting the background poll loop', async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(localRegistry, 'getCards').mockReturnValue([makeCard('mind-a', 'Agent A')]);
      relayClient.pollMessages.mockRejectedValueOnce(new Error('relay down'));
      const localDelivery = {
        deliverToLocalMind: vi.fn(async (_mindId, request) => ({ message: request.message })),
      };
      service = new A2ARelayModeService(
        localRegistry,
        activeResolver,
        () => relayClient as unknown as A2ARelayRegistryClientPort,
        localDelivery,
        1,
      );

      await service.connect({
        baseUrl: 'http://127.0.0.1:4100',
        authProvider: makeAuthProvider(),
      });
      await vi.runOnlyPendingTimersAsync();

      expect(service.getLastPollError()).toBe('relay down');
      await service.disconnect();
    } finally {
      vi.useRealTimers();
    }
  });
});

function makeCard(mindId: string, name: string): AgentCard {
  return {
    mindId,
    name,
    description: `${name} description`,
    version: '1.0.0',
    supportedInterfaces: [{ url: `chamber:mind:${encodeURIComponent(mindId)}`, protocolBinding: 'https://github.com/ianphil/chamber/a2a/bindings/in-process/v1', protocolVersion: '1.0' }],
    capabilities: { streaming: true },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [],
  };
}

function makeAuthProvider(header = 'Bearer relay-secret') {
  return { getAuthorizationHeader: async () => header };
}
