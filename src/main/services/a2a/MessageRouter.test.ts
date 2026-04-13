import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { MessageRouter } from './MessageRouter';
import type { AgentCard, SendMessageRequest } from './types';

const mockRegistry = {
  getCard: vi.fn() as any,
  getCards: vi.fn() as any,
  getCardByName: vi.fn() as any,
};

const mockChatService = {
  sendMessage: vi.fn(async () => {}),
};

function makeCard(overrides: Partial<AgentCard> & { mindId: string; name: string }): AgentCard {
  return {
    description: 'Test agent',
    version: '1.0.0',
    supportedInterfaces: [{ url: 'in-process', protocolBinding: 'IN_PROCESS', protocolVersion: '1.0' }],
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
      role: 'user',
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
    router = new MessageRouter(mockChatService as any, mockRegistry as any, emitter);
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

  it('sendMessage() assigns contextId on first message', async () => {
    mockRegistry.getCard.mockReturnValue(makeCard({ mindId: 'target-1', name: 'Target' }));
    const req = makeRequest('target-1', 'hello');
    // Ensure no contextId on request
    delete req.message.contextId;
    const res = await router.sendMessage(req);
    expect(res.message!.contextId).toMatch(/^ctx-/);
  });

  it('sendMessage() reuses contextId on follow-up', async () => {
    mockRegistry.getCard.mockReturnValue(makeCard({ mindId: 'target-1', name: 'Target' }));
    const req = makeRequest('target-1', 'follow-up', {
      message: { messageId: 'msg-2', role: 'user', parts: [{ text: 'follow-up' }], contextId: 'ctx-123' },
    });
    const res = await router.sendMessage(req);
    expect(res.message!.contextId).toBe('ctx-123');
  });

  it('sendMessage() rejects when context hops exceed MAX_HOPS', async () => {
    mockRegistry.getCard.mockReturnValue(makeCard({ mindId: 'target-1', name: 'Target' }));
    const contextId = 'ctx-loop';

    // Send 5 messages — each increments the context hop counter
    for (let i = 0; i < 5; i++) {
      await router.sendMessage(makeRequest('target-1', `msg-${i}`, {
        message: { messageId: `msg-${i}`, role: 'user', parts: [{ text: `msg-${i}` }], contextId, metadata: { fromId: 'a', fromName: 'A' } },
      }));
    }

    // 6th should be rejected (contextHops is now 5, exceeds MAX_HOPS)
    await expect(router.sendMessage(makeRequest('target-1', 'too many', {
      message: { messageId: 'msg-6', role: 'user', parts: [{ text: 'too many' }], contextId, metadata: { fromId: 'a', fromName: 'A' } },
    }))).rejects.toThrow(/hop count/i);
  });

  it('sendMessage() increments hop count per contextId', async () => {
    mockRegistry.getCard.mockReturnValue(makeCard({ mindId: 'target-1', name: 'Target' }));
    const contextId = 'ctx-hop-track';

    await router.sendMessage(makeRequest('target-1', 'first', {
      message: { messageId: 'msg-1', role: 'user', parts: [{ text: 'first' }], contextId, metadata: { fromId: 'a', fromName: 'A' } },
    }));
    // First message: hopCount should be 1
    expect(mockChatService.sendMessage.mock.calls[0][1]).toContain('hop-count="1"');

    await router.sendMessage(makeRequest('target-1', 'second', {
      message: { messageId: 'msg-2', role: 'user', parts: [{ text: 'second' }], contextId, metadata: { fromId: 'a', fromName: 'A' } },
    }));
    // Second message: hopCount should be 2
    expect(mockChatService.sendMessage.mock.calls[1][1]).toContain('hop-count="2"');
  });

  it('sendMessage() emits a2a:incoming before delivery', async () => {
    mockRegistry.getCard.mockReturnValue(makeCard({ mindId: 'target-1', name: 'Target' }));

    const events: any[] = [];
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
    expect(res.message!.messageId).toBe('msg-test-1');
    expect(res.message!.role).toBe('user');
    expect(res.message!.parts[0].text).toBe('response check');
    expect(res.message!.contextId).toBeDefined();
  });

  it('XML prompt contains structured envelope', async () => {
    mockRegistry.getCard.mockReturnValue(makeCard({ mindId: 'target-1', name: 'Target' }));
    const req = makeRequest('target-1', 'structured test', {
      message: {
        messageId: 'msg-xml',
        role: 'user',
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
    let resolveDelivery!: () => void;
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
    resolveDelivery();
    await deliveryPromise;
  });
});
