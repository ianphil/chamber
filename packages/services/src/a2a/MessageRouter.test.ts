import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { MessageRouter } from './MessageRouter';
import type { AgentCard, SendMessageRequest } from './types';
import type { ChatService } from '../chat/ChatService';
import type { AgentCardRegistry } from './AgentCardRegistry';

const mockRegistry = {
  getCard: vi.fn(),
  getCards: vi.fn(),
  getCardByName: vi.fn(),
};

const mockChatService = {
  sendMessage: vi.fn().mockResolvedValue(undefined),
};

function makeCard(overrides: Partial<AgentCard> & { mindId: string; name: string }): AgentCard {
  return {
    description: 'Test agent',
    version: '1.0.0',
    supportedInterfaces: [{ url: `chamber:mind:${encodeURIComponent(overrides.mindId)}`, protocolBinding: 'https://github.com/ianphil/chamber/a2a/bindings/in-process/v1', protocolVersion: '1.0' }],
    capabilities: { streaming: true },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [],
    ...overrides,
  };
}

function makeRequest(recipient: string, text: string, opts?: Partial<SendMessageRequest>): SendMessageRequest {
  return {
    recipient,
    message: {
      messageId: 'msg-test-1',
      role: 'ROLE_USER',
      parts: [{ text, mediaType: 'text/plain' }],
      metadata: { fromId: 'sender-1', fromName: 'Sender', hopCount: 0 },
      ...opts?.message,
    },
    configuration: { returnImmediately: true, ...opts?.configuration },
    ...opts,
  };
}

describe('MessageRouter', () => {
  let router: MessageRouter;
  let emitter: EventEmitter;

  beforeEach(() => {
    vi.clearAllMocks();
    emitter = new EventEmitter();
    router = new MessageRouter(mockChatService as unknown as ChatService, mockRegistry as unknown as AgentCardRegistry, emitter);
  });

  it('sendMessage() resolves recipient by mindId', async () => {
    mockRegistry.getCard.mockReturnValue(makeCard({ mindId: 'target-1', name: 'Target' }));
    const req = makeRequest('target-1', 'hello');
    const res = await router.sendMessage(req);
    expect(mockRegistry.getCard).toHaveBeenCalledWith('target-1');
    expect(res.message).toBeDefined();
  });

  it('sendMessage() resolves recipient by name via registry', async () => {
    mockRegistry.getCard.mockReturnValue(null);
    mockRegistry.getCardByName.mockReturnValue(makeCard({ mindId: 'target-1', name: 'Target' }));
    const req = makeRequest('Target', 'hello');
    const res = await router.sendMessage(req);
    expect(mockRegistry.getCardByName).toHaveBeenCalledWith('Target');
    expect(res.message).toBeDefined();
  });

  it('sendMessage() rejects unknown recipient', async () => {
    mockRegistry.getCard.mockReturnValue(null);
    mockRegistry.getCardByName.mockReturnValue(null);
    const req = makeRequest('nobody', 'hello');
    await expect(router.sendMessage(req)).rejects.toThrow('Unknown recipient: nobody');
  });

  it('sendMessage() refuses cards that are not backed by a local mind', async () => {
    mockRegistry.getCard.mockReturnValue(makeCard({
      mindId: undefined as never,
      name: 'Copilot CLI',
      supportedInterfaces: [{ url: 'http://127.0.0.1:4123/a2a', protocolBinding: 'HTTP+JSON', protocolVersion: '1.0' }],
    }));

    await expect(router.sendMessage(makeRequest('Copilot CLI', 'hello'))).rejects.toThrow('Unknown local recipient: Copilot CLI');
  });

  it('sendMessage() routes non-local cards through the active relay transport', async () => {
    const sendMessage = vi.fn(async (request: SendMessageRequest) => ({ message: request.message }));
    router = new MessageRouter(mockChatService as unknown as ChatService, {
      getCard: vi.fn(() => makeCard({
        mindId: undefined as never,
        name: 'Copilot CLI',
        supportedInterfaces: [{ url: 'http://127.0.0.1:4123/a2a', protocolBinding: 'HTTP+JSON', protocolVersion: '1.0' }],
      })),
      getCardByName: vi.fn(),
      getCards: vi.fn(),
      canSendMessage: () => true,
      sendMessage,
    }, emitter);

    const response = await router.sendMessage(makeRequest('Copilot CLI', 'hello'));

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      recipient: 'Copilot CLI',
      message: expect.objectContaining({ contextId: expect.stringMatching(/^ctx-/) }),
    }));
    expect(mockChatService.sendMessage).not.toHaveBeenCalled();
    expect(response.message?.parts[0].text).toBe('hello');
  });

  it('sendMessage() routes relay-discovered Chamber mind cards through the relay transport', async () => {
    const sendMessage = vi.fn(async (request: SendMessageRequest) => ({ queued: true, queueMessageId: 'relay-msg-1', message: request.message }));
    router = new MessageRouter(mockChatService as unknown as ChatService, {
      getCard: vi.fn(() => makeCard({
        mindId: 'remote-mind-1',
        name: 'Remote Mind',
        supportedInterfaces: [{ url: 'https://switchboard.example.com/message:send', protocolBinding: 'https://github.com/ianphil/chamber/a2a/bindings/relay-mailbox/v1', protocolVersion: '1.0' }],
      })),
      getCardByName: vi.fn(),
      getCards: vi.fn(),
      canSendMessage: () => true,
      sendMessage,
    }, emitter);

    const response = await router.sendMessage(makeRequest('remote-mind-1', 'hello relay'));

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      recipient: 'remote-mind-1',
      message: expect.objectContaining({ contextId: expect.stringMatching(/^ctx-/) }),
    }));
    expect(mockChatService.sendMessage).not.toHaveBeenCalled();
    expect(response).toEqual(expect.objectContaining({ queued: true, queueMessageId: 'relay-msg-1' }));
  });

  it('sendMessage() assigns contextId on first message', async () => {
    mockRegistry.getCard.mockReturnValue(makeCard({ mindId: 'target-1', name: 'Target' }));
    const req = makeRequest('target-1', 'hello');
    // Ensure no contextId on request
    delete req.message.contextId;
    const res = await router.sendMessage(req);
    if (!res.message) throw new Error('Expected message in response');
    expect(res.message.contextId).toMatch(/^ctx-/);
  });

  it('sendMessage() reuses contextId on follow-up', async () => {
    mockRegistry.getCard.mockReturnValue(makeCard({ mindId: 'target-1', name: 'Target' }));
    const req = makeRequest('target-1', 'follow-up', {
      message: { messageId: 'msg-2', role: 'ROLE_USER', parts: [{ text: 'follow-up' }], contextId: 'ctx-123' },
    });
    const res = await router.sendMessage(req);
    if (!res.message) throw new Error('Expected message in response');
    expect(res.message.contextId).toBe('ctx-123');
  });

  it('sendMessage() rejects when forwarded message hops exceed MAX_HOPS', async () => {
    mockRegistry.getCard.mockReturnValue(makeCard({ mindId: 'target-1', name: 'Target' }));

    await expect(router.sendMessage(makeRequest('target-1', 'too many', {
      message: {
        messageId: 'msg-6',
        role: 'ROLE_USER',
        parts: [{ text: 'too many' }],
        contextId: 'ctx-loop',
        metadata: { fromId: 'a', fromName: 'A', hopCount: 5 },
      },
    }))).rejects.toThrow(/hop count/i);
  });

  it('sendMessage() increments hop count from the incoming message metadata', async () => {
    mockRegistry.getCard.mockReturnValue(makeCard({ mindId: 'target-1', name: 'Target' }));
    const contextId = 'ctx-hop-track';

    await router.sendMessage(makeRequest('target-1', 'first', {
      message: { messageId: 'msg-1', role: 'ROLE_USER', parts: [{ text: 'first' }], contextId, metadata: { fromId: 'a', fromName: 'A' } },
    }));
    // First message: hopCount should be 1
    expect(mockChatService.sendMessage.mock.calls[0][1]).toContain('hop-count="1"');

    await router.sendMessage(makeRequest('target-1', 'second', {
      message: { messageId: 'msg-2', role: 'ROLE_USER', parts: [{ text: 'second' }], contextId, metadata: { fromId: 'a', fromName: 'A', hopCount: 1 } },
    }));
    // Second message: hopCount should be 2
    expect(mockChatService.sendMessage.mock.calls[1][1]).toContain('hop-count="2"');
  });

  it('sendMessage() emits a2a:incoming before delivery', async () => {
    mockRegistry.getCard.mockReturnValue(makeCard({ mindId: 'target-1', name: 'Target' }));

    const events: Array<{ targetMindId: string; message: unknown; replyMessageId: string }> = [];
    emitter.on('a2a:incoming', (payload) => events.push(payload));

    // Track ordering: record when event fires vs when chatService is called
    let eventFiredBeforeChat = false;
    mockChatService.sendMessage.mockImplementation(async () => {
      eventFiredBeforeChat = events.length > 0;
    });

    const req = makeRequest('target-1', 'hi');
    await router.sendMessage(req);

    expect(events).toHaveLength(1);
    expect(events[0].targetMindId).toBe('target-1');
    expect(events[0].message).toBeDefined();
    expect(events[0].replyMessageId).toMatch(/^msg-/);
    expect(eventFiredBeforeChat).toBe(true);
  });

  it('sendMessage() delivers via ChatService', async () => {
    mockRegistry.getCard.mockReturnValue(makeCard({ mindId: 'target-1', name: 'Target' }));
    const req = makeRequest('target-1', 'deliver me');
    await router.sendMessage(req);

    expect(mockChatService.sendMessage).toHaveBeenCalledTimes(1);
    const [mindId, xmlPrompt, messageId, emitFn] = mockChatService.sendMessage.mock.calls[0];
    expect(mindId).toBe('target-1');
    expect(xmlPrompt).toContain('<agent-message');
    expect(messageId).toMatch(/^msg-/);
    expect(typeof emitFn).toBe('function');
  });

  it('sendMessage() returns SendMessageResponse with message', async () => {
    mockRegistry.getCard.mockReturnValue(makeCard({ mindId: 'target-1', name: 'Target' }));
    const req = makeRequest('target-1', 'response check');
    const res = await router.sendMessage(req);

    expect(res.message).toBeDefined();
    if (!res.message) throw new Error('Expected message in response');
    expect(res.message.messageId).toBe('msg-test-1');
    expect(res.message.role).toBe('ROLE_USER');
    expect(res.message.parts[0].text).toBe('response check');
    expect(res.message.contextId).toBeDefined();
  });

  it('XML prompt contains structured envelope', async () => {
    mockRegistry.getCard.mockReturnValue(makeCard({ mindId: 'target-1', name: 'Target' }));
    const req = makeRequest('target-1', 'structured test', {
      message: {
        messageId: 'msg-xml',
        role: 'ROLE_USER',
        parts: [{ text: 'structured test', mediaType: 'text/plain' }],
        metadata: { fromId: 'sender-1', fromName: 'Sender', hopCount: 0 },
      },
    });
    await router.sendMessage(req);

    const xmlPrompt = mockChatService.sendMessage.mock.calls[0][1] as string;
    expect(xmlPrompt).toContain('<agent-message');
    expect(xmlPrompt).toContain('from-id="sender-1"');
    expect(xmlPrompt).toContain('from-name="Sender"');
    expect(xmlPrompt).toContain('message-id="msg-xml"');
    expect(xmlPrompt).toContain('<content>structured test</content>');
    expect(xmlPrompt).toContain('</agent-message>');
  });

  it('sendMessage() returns immediately when returnImmediately is true', async () => {
    mockRegistry.getCard.mockReturnValue(makeCard({ mindId: 'target-1', name: 'Target' }));

    // Make chatService.sendMessage hang until we resolve it
    let resolveDelivery: (() => void) | undefined;
    const deliveryPromise = new Promise<void>((resolve) => {
      resolveDelivery = resolve;
    });
    mockChatService.sendMessage.mockReturnValue(deliveryPromise);

    const req = makeRequest('target-1', 'fire and forget', {
      configuration: { returnImmediately: true },
    });

    // Router should resolve before chatService finishes
    const res = await router.sendMessage(req);
    expect(res.message).toBeDefined();

    // ChatService was called but hasn't resolved yet
    expect(mockChatService.sendMessage).toHaveBeenCalledTimes(1);

    // Clean up
    if (!resolveDelivery) throw new Error('Expected resolveDelivery');
    resolveDelivery();
    await deliveryPromise;
  });
});
