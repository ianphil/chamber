import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActiveA2AResolver, type RelayA2AResolverClient } from './ActiveA2AResolver';
import { AgentCardRegistry } from './AgentCardRegistry';
import type { AgentCard } from './types';

describe('ActiveA2AResolver', () => {
  let localRegistry: AgentCardRegistry;
  let resolver: ActiveA2AResolver;

  beforeEach(() => {
    localRegistry = new AgentCardRegistry();
    resolver = new ActiveA2AResolver(localRegistry);
  });

  it('uses the local registry by default', async () => {
    const localCard = makeCard('local-mind', 'Local Agent');
    vi.spyOn(localRegistry, 'getCard').mockReturnValue(localCard);
    vi.spyOn(localRegistry, 'getCards').mockReturnValue([localCard]);

    expect(resolver.getMode()).toBe('local');
    expect(await resolver.getCard('local-mind')).toBe(localCard);
    expect(await resolver.getCards()).toEqual([localCard]);
  });

  it('uses only the relay registry in relay mode', async () => {
    const localCard = makeCard('local-mind', 'Local Agent');
    const relayCard = makeCard('relay-agent', 'Relay Agent');
    const localGetCard = vi.spyOn(localRegistry, 'getCard').mockReturnValue(localCard);
    const relayClient: RelayA2AResolverClient = {
      getCard: vi.fn(async () => relayCard),
      getCards: vi.fn(async () => [relayCard]),
    };

    resolver.useRelay(relayClient);

    expect(resolver.getMode()).toBe('relay');
    expect(await resolver.getCard('local-mind')).toBe(relayCard);
    expect(await resolver.getCards()).toEqual([relayCard]);
    expect(localGetCard).not.toHaveBeenCalled();
  });

  it('exposes relay message transport only in relay mode', async () => {
    const request = {
      recipient: 'relay-agent',
      message: { messageId: 'msg-1', role: 'ROLE_USER' as const, parts: [{ text: 'hello' }] },
    };
    const response = { message: request.message };

    expect(resolver.canSendMessage()).toBe(false);
    await expect(resolver.sendMessage(request)).rejects.toThrow('A2A relay transport is not connected');

    resolver.useRelay({
      getCard: vi.fn(async () => null),
      getCards: vi.fn(async () => []),
      sendMessage: vi.fn(async () => response),
    });

    expect(resolver.canSendMessage()).toBe(true);
    await expect(resolver.sendMessage(request)).resolves.toBe(response);
  });

  it('returns to the local registry when relay mode is disabled', async () => {
    const localCard = makeCard('local-mind', 'Local Agent');
    const relayCard = makeCard('relay-agent', 'Relay Agent');
    vi.spyOn(localRegistry, 'getCard').mockReturnValue(localCard);

    resolver.useRelay({
      getCard: vi.fn(async () => relayCard),
      getCards: vi.fn(async () => [relayCard]),
    });
    resolver.useLocal();

    expect(resolver.getMode()).toBe('local');
    expect(await resolver.getCard('local-mind')).toBe(localCard);
  });

  it('resolves relay cards by unique name when the client does not provide a name lookup', async () => {
    const relayCard = makeCard('relay-agent', 'Relay Agent');
    resolver.useRelay({
      getCard: vi.fn(async () => null),
      getCards: vi.fn(async () => [relayCard]),
    });

    expect(await resolver.getCardByName('Relay Agent')).toBe(relayCard);
    expect(await resolver.getCardByName('Missing Agent')).toBeNull();
  });

  it('does not guess when relay card names are ambiguous', async () => {
    resolver.useRelay({
      getCard: vi.fn(async () => null),
      getCards: vi.fn(async () => [
        makeCard('relay-a', 'Relay Agent'),
        makeCard('relay-b', 'Relay Agent'),
      ]),
    });

    expect(await resolver.getCardByName('Relay Agent')).toBeNull();
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
