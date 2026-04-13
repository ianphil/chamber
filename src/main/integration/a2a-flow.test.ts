import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { TurnQueue } from '../services/chat/TurnQueue';
import { ChatService } from '../services/chat/ChatService';
import { AgentCardRegistry } from '../services/a2a/AgentCardRegistry';
import { MessageRouter } from '../services/a2a/MessageRouter';
import { buildSessionTools } from '../services/a2a/tools';
import type { SendMessageRequest } from '../services/a2a/types';

// --- Mock SDK primitives ---

function makeMockSession() {
  return {
    send: vi.fn(async () => {}),
    abort: vi.fn(async () => {}),
    on: vi.fn((event: string, cb?: any) => {
      // Fire session.idle immediately after send
      if (event === 'session.idle' && cb) {
        setTimeout(() => cb(), 0);
      }
      return vi.fn();
    }),
  };
}

function makeMockMindManager() {
  const sessions = new Map<string, ReturnType<typeof makeMockSession>>();
  const emitter = new EventEmitter();

  const mgr = Object.assign(emitter, {
    getMind: vi.fn((mindId: string) => {
      if (!sessions.has(mindId)) return undefined;
      return {
        session: sessions.get(mindId),
        client: { listModels: vi.fn(async () => []) },
      };
    }),
    recreateSession: vi.fn(async () => {}),
    _addMind(mindId: string, name: string, mindPath: string) {
      sessions.set(mindId, makeMockSession());
      emitter.emit('mind:loaded', {
        mindId,
        mindPath,
        identity: { name, systemMessage: `I am ${name}` },
        status: 'ready',
      });
    },
  });

  return mgr;
}

describe('A2A Integration', () => {
  let mindManager: ReturnType<typeof makeMockMindManager>;
  let turnQueue: TurnQueue;
  let chatService: ChatService;
  let agentCardRegistry: AgentCardRegistry;
  let messageRouter: MessageRouter;
  let a2aEventBus: EventEmitter;

  beforeEach(() => {
    vi.clearAllMocks();
    mindManager = makeMockMindManager();
    turnQueue = new TurnQueue();
    chatService = new ChatService(mindManager as any, turnQueue);
    agentCardRegistry = new AgentCardRegistry();
    a2aEventBus = new EventEmitter();
    messageRouter = new MessageRouter(chatService, agentCardRegistry, a2aEventBus);

    // Wire registry to mind lifecycle (mirrors main.ts)
    mindManager.on('mind:loaded', (ctx: any) => agentCardRegistry.register(ctx));
    mindManager.on('mind:unloaded', (mindId: string) => agentCardRegistry.unregister(mindId));

    // Load two minds
    mindManager._addMind('agent-a', 'Agent A', 'C:\\agents\\a');
    mindManager._addMind('agent-b', 'Agent B', 'C:\\agents\\b');
  });

  it('end-to-end: Agent A sends message to Agent B', async () => {
    // Verify registry has both agents
    expect(agentCardRegistry.getCards()).toHaveLength(2);
    expect(agentCardRegistry.getCard('agent-a')).toBeTruthy();
    expect(agentCardRegistry.getCard('agent-b')).toBeTruthy();

    // Build tools for Agent A
    const tools = buildSessionTools('agent-a', [], messageRouter, agentCardRegistry);
    const sendTool = tools.find(t => t.name === 'a2a_send_message')!;

    // Track a2a:incoming
    const incomingEvents: unknown[] = [];
    a2aEventBus.on('a2a:incoming', (payload) => incomingEvents.push(payload));

    // Agent A sends message to Agent B
    const result = await sendTool.handler({ recipient: 'agent-b', message: 'Hello from A' }) as any;

    // Verify response
    expect(result.message).toBeDefined();
    expect(result.message.contextId).toBeTruthy();
    expect(result.message.parts[0].text).toBe('Hello from A');

    // Verify a2a:incoming was emitted
    expect(incomingEvents).toHaveLength(1);
    const incoming = incomingEvents[0] as any;
    expect(incoming.targetMindId).toBe('agent-b');
    expect(incoming.replyMessageId).toBeTruthy();

    // Verify ChatService was called for Agent B
    const bSession = mindManager.getMind('agent-b')!.session;
    expect(bSession.send).toHaveBeenCalled();
    const prompt = bSession.send.mock.calls[0][0].prompt;
    expect(prompt).toContain('<agent-message');
    expect(prompt).toContain('from-name="agent-a"');
    expect(prompt).toContain('Hello from A');
  });

  it('end-to-end: message queues behind active turn', async () => {
    const order: string[] = [];

    // Start a long-running user turn on Agent B
    const bSession = mindManager.getMind('agent-b')!.session;
    let resolveUserTurn: () => void;
    const userTurnDone = new Promise<void>(r => { resolveUserTurn = r; });

    bSession.send.mockImplementationOnce(async () => {
      order.push('user-turn-start');
      await userTurnDone;
      order.push('user-turn-end');
    });

    // Fire session.idle after send completes
    bSession.on.mockImplementation((event: string, cb?: any) => {
      if (event === 'session.idle' && cb) {
        userTurnDone.then(() => setTimeout(() => cb(), 0));
      }
      return vi.fn();
    });

    // Start user chat (don't await yet)
    const userChatPromise = chatService.sendMessage('agent-b', 'User message', 'user-msg-1', vi.fn());

    // Give the user turn a moment to start
    await new Promise(r => setTimeout(r, 10));

    // Now Agent A sends A2A message — should queue behind user turn
    bSession.send.mockImplementationOnce(async () => {
      order.push('a2a-turn');
    });
    bSession.on.mockImplementation((event: string, cb?: any) => {
      if (event === 'session.idle' && cb) {
        setTimeout(() => cb(), 0);
      }
      return vi.fn();
    });

    const a2aPromise = messageRouter.sendMessage({
      recipient: 'agent-b',
      message: {
        messageId: 'msg-a2a',
        role: 'user',
        parts: [{ text: 'A2A message' }],
        metadata: { fromId: 'agent-a', fromName: 'Agent A', hopCount: 0 },
      },
      configuration: { returnImmediately: false },
    });

    // Resolve user turn
    resolveUserTurn!();
    await userChatPromise;
    await a2aPromise;

    expect(order[0]).toBe('user-turn-start');
    expect(order[1]).toBe('user-turn-end');
    expect(order[2]).toBe('a2a-turn');
  });

  it('end-to-end: hop count prevents message loop', async () => {
    const contextId = 'ctx-loop-test';

    // Send MAX_HOPS messages on the same contextId — each increments the counter
    for (let i = 0; i < 5; i++) {
      await messageRouter.sendMessage({
        recipient: 'agent-b',
        message: {
          messageId: `msg-loop-${i}`,
          role: 'user',
          parts: [{ text: `Loop ${i}` }],
          contextId,
          metadata: { fromId: 'agent-a', fromName: 'Agent A' },
        },
        configuration: { returnImmediately: true },
      });
    }

    // The 6th message should be rejected (contextHops is now 5, which exceeds MAX_HOPS)
    await expect(messageRouter.sendMessage({
      recipient: 'agent-b',
      message: {
        messageId: 'msg-loop-6',
        role: 'user',
        parts: [{ text: 'Loop 6' }],
        contextId,
        metadata: { fromId: 'agent-a', fromName: 'Agent A' },
      },
    })).rejects.toThrow(/hop count/i);
  });
});
