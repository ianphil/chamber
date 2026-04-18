import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock node:crypto for UUID generation
const mockRandomUUID = vi.fn(() => 'test-uuid');
vi.mock('node:crypto', () => ({
  randomUUID: (...args: unknown[]) => mockRandomUUID(...args),
}));

import { GroupChatStrategy } from './GroupChatStrategy';
import type { OrchestrationContext } from './types';
import type { MindContext } from '../../../../shared/types';
import type { ChatroomStreamEvent, GroupChatConfig } from '../../../../shared/chatroom-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockSession() {
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  return {
    send: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, []);
      const list = listeners.get(event);
      if (!list) throw new Error('expected listener list');
      list.push(cb);
      const unsub = vi.fn(() => {
        const cbs = listeners.get(event);
        if (cbs) {
          const idx = cbs.indexOf(cb);
          if (idx >= 0) cbs.splice(idx, 1);
        }
      });
      return unsub;
    }),
    _emit(event: string, data: unknown) {
      for (const cb of listeners.get(event) ?? []) cb(data);
    },
    _listeners: listeners,
  };
}

function autoIdleWith(session: ReturnType<typeof createMockSession>, content: string) {
  session.send.mockImplementation(async () => {
    setTimeout(() => {
      session._emit('assistant.message', {
        data: { messageId: 'sdk-msg-1', content },
      });
      session._emit('session.idle', {});
    }, 0);
  });
}

function makeMind(id: string, name: string): MindContext {
  return {
    mindId: id,
    mindPath: `/minds/${id}`,
    identity: { name, systemMessage: `I am ${name}` },
    status: 'ready',
  };
}

function makeConfig(overrides?: Partial<GroupChatConfig>): GroupChatConfig {
  return {
    moderatorMindId: 'mod',
    maxTurns: 10,
    minRounds: 1,
    maxSpeakerRepeats: 3,
    ...overrides,
  };
}

function createContext(
  sessions: Map<string, ReturnType<typeof createMockSession>>,
  overrides?: Partial<OrchestrationContext>,
): OrchestrationContext {
  return {
    getOrCreateSession: vi.fn(async (mindId: string) => {
      if (!sessions.has(mindId)) sessions.set(mindId, createMockSession());
      return sessions.get(mindId)!;
    }),
    evictSession: vi.fn((mindId: string) => {
      sessions.delete(mindId);
    }),
    buildBasePrompt: vi.fn(() => '<message sender="You">test</message>'),
    emitEvent: vi.fn(),
    persistMessage: vi.fn(),
    getHistory: vi.fn(() => []),
    orchestrationMode: 'group-chat',
    ...overrides,
  };
}

let uuidCounter = 0;
function resetUUIDs() {
  uuidCounter = 0;
  mockRandomUUID.mockImplementation(() => `uuid-${++uuidCounter}`);
}

// Moderator JSON helper
function moderatorResponse(nextSpeaker: string, action: 'direct' | 'close' = 'direct', direction = '') {
  return JSON.stringify({ next_speaker: nextSpeaker, direction, action });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GroupChatStrategy', () => {
  let sessions: Map<string, ReturnType<typeof createMockSession>>;
  const moderator = makeMind('mod', 'Moderator');
  const agentA = makeMind('a', 'Cortana');
  const agentB = makeMind('b', 'Jarvis');
  const participants = [moderator, agentA, agentB];

  beforeEach(() => {
    vi.clearAllMocks();
    resetUUIDs();
    sessions = new Map();
  });

  it('moderator receives structured XML prompt', async () => {
    const modSess = createMockSession();
    const aSess = createMockSession();
    const bSess = createMockSession();
    sessions.set('mod', modSess);
    sessions.set('a', aSess);
    sessions.set('b', bSess);

    // Both speakers must have sessions — moderator may pick either
    autoIdleWith(aSess, 'Cortana speaks');
    autoIdleWith(bSess, 'Jarvis speaks');

    // Moderator decides to close after first speaker (all heard + minRounds=1 with only 1 speaker needed)
    // But we have 2 speakers so this won't close yet. Let's set maxTurns=1 as safety cap.
    let moderatorPrompt = '';
    modSess.send.mockImplementation(async (opts: { prompt: string }) => {
      moderatorPrompt = opts.prompt;
      setTimeout(() => {
        modSess._emit('assistant.message', {
          data: { messageId: 'sdk-mod', content: moderatorResponse('Jarvis') },
        });
        modSess._emit('session.idle', {});
      }, 0);
    });

    const config = makeConfig({ maxTurns: 1 });
    const strategy = new GroupChatStrategy(config);
    const ctx = createContext(sessions);

    await strategy.execute('What should we do?', participants, 'round-1', ctx);

    expect(moderatorPrompt).toContain('<group-chat-moderation');
    expect(moderatorPrompt).toContain('Cortana');
  });

  it('moderator JSON response is parsed to extract next_speaker', async () => {
    const modSess = createMockSession();
    const aSess = createMockSession();
    const bSess = createMockSession();
    sessions.set('mod', modSess);
    sessions.set('a', aSess);
    sessions.set('b', bSess);

    autoIdleWith(aSess, 'Cortana speaks');
    autoIdleWith(bSess, 'Jarvis speaks');

    // Turn 1: Cortana speaks, moderator directs Jarvis
    // Turn 2: Jarvis speaks, moderator closes
    let turnCount = 0;
    modSess.send.mockImplementation(async () => {
      turnCount++;
      const content = turnCount === 1
        ? moderatorResponse('Jarvis')
        : moderatorResponse('', 'close');
      setTimeout(() => {
        modSess._emit('assistant.message', {
          data: { messageId: `sdk-mod-${turnCount}`, content },
        });
        modSess._emit('session.idle', {});
      }, 0);
    });

    const config = makeConfig({ minRounds: 1 });
    const strategy = new GroupChatStrategy(config);
    const ctx = createContext(sessions);

    await strategy.execute('Question?', participants, 'round-1', ctx);

    // Both speakers should have been called
    expect(aSess.send).toHaveBeenCalled();
    expect(bSess.send).toHaveBeenCalled();
  });

  it('safety rail: max turns enforced', async () => {
    const modSess = createMockSession();
    const aSess = createMockSession();
    sessions.set('mod', modSess);
    sessions.set('a', aSess);

    autoIdleWith(aSess, 'Cortana speaks');

    // Moderator always directs back to Cortana
    modSess.send.mockImplementation(async () => {
      setTimeout(() => {
        modSess._emit('assistant.message', {
          data: { messageId: 'sdk-mod', content: moderatorResponse('Cortana') },
        });
        modSess._emit('session.idle', {});
      }, 0);
    });

    const config = makeConfig({ maxTurns: 3 });
    const strategy = new GroupChatStrategy(config);
    const ctx = createContext(sessions);

    await strategy.execute('Question?', participants, 'round-1', ctx);

    // Agent A (Cortana) should be called at most maxTurns times
    expect(aSess.send.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('max speaker repeats enforced — falls back to least spoken', async () => {
    const modSess = createMockSession();
    const aSess = createMockSession();
    const bSess = createMockSession();
    sessions.set('mod', modSess);
    sessions.set('a', aSess);
    sessions.set('b', bSess);

    autoIdleWith(aSess, 'Cortana');
    autoIdleWith(bSess, 'Jarvis');

    // Moderator always picks Cortana (should trigger max repeat fallback)
    let turnCount = 0;
    modSess.send.mockImplementation(async () => {
      turnCount++;
      const content = turnCount >= 5
        ? moderatorResponse('', 'close')
        : moderatorResponse('Cortana');
      setTimeout(() => {
        modSess._emit('assistant.message', {
          data: { messageId: `sdk-mod-${turnCount}`, content },
        });
        modSess._emit('session.idle', {});
      }, 0);
    });

    const config = makeConfig({ maxTurns: 6, maxSpeakerRepeats: 2 });
    const strategy = new GroupChatStrategy(config);
    const ctx = createContext(sessions);

    await strategy.execute('Question?', participants, 'round-1', ctx);

    // Jarvis should have been called at some point (fallback from max repeats)
    expect(bSess.send).toHaveBeenCalled();
  });

  it('cannot close before all participants heard (minRounds enforced)', async () => {
    const modSess = createMockSession();
    const aSess = createMockSession();
    const bSess = createMockSession();
    sessions.set('mod', modSess);
    sessions.set('a', aSess);
    sessions.set('b', bSess);

    autoIdleWith(aSess, 'Cortana speaks');
    autoIdleWith(bSess, 'Jarvis speaks');

    // Moderator tries to close immediately after first speaker
    let turnCount = 0;
    modSess.send.mockImplementation(async () => {
      turnCount++;
      // Always try to close
      const content = moderatorResponse('', 'close');
      setTimeout(() => {
        modSess._emit('assistant.message', {
          data: { messageId: `sdk-mod-${turnCount}`, content },
        });
        modSess._emit('session.idle', {});
      }, 0);
    });

    const config = makeConfig({ minRounds: 1, maxTurns: 10 });
    const strategy = new GroupChatStrategy(config);
    const ctx = createContext(sessions);

    await strategy.execute('Question?', participants, 'round-1', ctx);

    // Both speakers must have spoken (minRounds=1 means everyone heard once)
    expect(aSess.send).toHaveBeenCalled();
    expect(bSess.send).toHaveBeenCalled();
  });

  it('convergence: moderator "close" terminates loop and emits convergence event', async () => {
    const modSess = createMockSession();
    const aSess = createMockSession();
    const bSess = createMockSession();
    sessions.set('mod', modSess);
    sessions.set('a', aSess);
    sessions.set('b', bSess);

    autoIdleWith(aSess, 'Cortana');
    autoIdleWith(bSess, 'Jarvis');

    let turnCount = 0;
    modSess.send.mockImplementation(async () => {
      turnCount++;
      let content: string;
      if (turnCount === 1) content = moderatorResponse('Jarvis');
      else content = moderatorResponse('', 'close');
      setTimeout(() => {
        modSess._emit('assistant.message', {
          data: { messageId: `sdk-mod-${turnCount}`, content },
        });
        modSess._emit('session.idle', {});
      }, 0);
    });

    const config = makeConfig({ minRounds: 1 });
    const strategy = new GroupChatStrategy(config);
    const ctx = createContext(sessions);

    await strategy.execute('Question?', participants, 'round-1', ctx);

    const events = (ctx.emitEvent as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0] as ChatroomStreamEvent,
    );
    const convergence = events.filter((e) => e.event.type === 'orchestration:convergence');
    expect(convergence.length).toBeGreaterThanOrEqual(1);
  });

  it('unknown next_speaker falls back to first unheard participant', async () => {
    const modSess = createMockSession();
    const aSess = createMockSession();
    const bSess = createMockSession();
    sessions.set('mod', modSess);
    sessions.set('a', aSess);
    sessions.set('b', bSess);

    autoIdleWith(aSess, 'Cortana');
    autoIdleWith(bSess, 'Jarvis');

    let turnCount = 0;
    modSess.send.mockImplementation(async () => {
      turnCount++;
      let content: string;
      if (turnCount === 1) content = moderatorResponse('NonExistentAgent');
      else content = moderatorResponse('', 'close');
      setTimeout(() => {
        modSess._emit('assistant.message', {
          data: { messageId: `sdk-mod-${turnCount}`, content },
        });
        modSess._emit('session.idle', {});
      }, 0);
    });

    const config = makeConfig({ minRounds: 1, maxTurns: 5 });
    const strategy = new GroupChatStrategy(config);
    const ctx = createContext(sessions);

    await strategy.execute('Question?', participants, 'round-1', ctx);

    // Should still have called at least one speaker (fallback)
    const totalSpeakerCalls = aSess.send.mock.calls.length + bSess.send.mock.calls.length;
    expect(totalSpeakerCalls).toBeGreaterThan(0);
  });

  it('moderator parse failure falls back to next unheard participant', async () => {
    const modSess = createMockSession();
    const aSess = createMockSession();
    const bSess = createMockSession();
    sessions.set('mod', modSess);
    sessions.set('a', aSess);
    sessions.set('b', bSess);

    autoIdleWith(aSess, 'Cortana');
    autoIdleWith(bSess, 'Jarvis');

    let turnCount = 0;
    modSess.send.mockImplementation(async () => {
      turnCount++;
      const content = turnCount <= 2
        ? 'I think we should talk more'  // Unparseable — no JSON
        : moderatorResponse('', 'close');
      setTimeout(() => {
        modSess._emit('assistant.message', {
          data: { messageId: `sdk-mod-${turnCount}`, content },
        });
        modSess._emit('session.idle', {});
      }, 0);
    });

    const config = makeConfig({ minRounds: 1, maxTurns: 5 });
    const strategy = new GroupChatStrategy(config);
    const ctx = createContext(sessions);

    await strategy.execute('Question?', participants, 'round-1', ctx);

    // Both speakers should have been reached via fallback
    expect(aSess.send).toHaveBeenCalled();
    expect(bSess.send).toHaveBeenCalled();
  });

  it('synthesis step sends full transcript to moderator', async () => {
    const modSess = createMockSession();
    const aSess = createMockSession();
    const bSess = createMockSession();
    sessions.set('mod', modSess);
    sessions.set('a', aSess);
    sessions.set('b', bSess);

    autoIdleWith(aSess, 'Cortana');
    autoIdleWith(bSess, 'Jarvis');

    let turnCount = 0;
    modSess.send.mockImplementation(async () => {
      turnCount++;
      let content: string;
      if (turnCount === 1) content = moderatorResponse('Jarvis');
      else content = moderatorResponse('', 'close');
      setTimeout(() => {
        modSess._emit('assistant.message', {
          data: { messageId: `sdk-mod-${turnCount}`, content },
        });
        modSess._emit('session.idle', {});
      }, 0);
    });

    const config = makeConfig({ minRounds: 1 });
    const strategy = new GroupChatStrategy(config);
    const ctx = createContext(sessions);

    await strategy.execute('Question?', participants, 'round-1', ctx);

    const events = (ctx.emitEvent as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0] as ChatroomStreamEvent,
    );
    const synthesis = events.filter((e) => e.event.type === 'orchestration:synthesis');
    expect(synthesis.length).toBeGreaterThanOrEqual(1);
  });

  it('emits orchestration:* events at correct points', async () => {
    const modSess = createMockSession();
    const aSess = createMockSession();
    const bSess = createMockSession();
    sessions.set('mod', modSess);
    sessions.set('a', aSess);
    sessions.set('b', bSess);

    autoIdleWith(aSess, 'Cortana');
    autoIdleWith(bSess, 'Jarvis');

    let turnCount = 0;
    modSess.send.mockImplementation(async () => {
      turnCount++;
      const content = turnCount === 1
        ? moderatorResponse('Jarvis')
        : moderatorResponse('', 'close');
      setTimeout(() => {
        modSess._emit('assistant.message', {
          data: { messageId: `sdk-mod-${turnCount}`, content },
        });
        modSess._emit('session.idle', {});
      }, 0);
    });

    const config = makeConfig({ minRounds: 1 });
    const strategy = new GroupChatStrategy(config);
    const ctx = createContext(sessions);

    await strategy.execute('Question?', participants, 'round-1', ctx);

    const events = (ctx.emitEvent as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0] as ChatroomStreamEvent,
    );
    const eventTypes = events.map((e) => e.event.type);

    expect(eventTypes).toContain('orchestration:turn-start');
    expect(eventTypes).toContain('orchestration:moderator-decision');
    expect(eventTypes).toContain('orchestration:convergence');
    expect(eventTypes).toContain('orchestration:synthesis');
  });

  it('returns early if moderator mind not found', async () => {
    const config = makeConfig({ moderatorMindId: 'nonexistent' });
    const strategy = new GroupChatStrategy(config);
    const ctx = createContext(sessions);

    await strategy.execute('Hello', participants, 'round-1', ctx);

    expect(ctx.getOrCreateSession).not.toHaveBeenCalled();
  });

  it('does nothing with 0 participants', async () => {
    const config = makeConfig();
    const strategy = new GroupChatStrategy(config);
    const ctx = createContext(sessions);

    await strategy.execute('Hello', [], 'round-1', ctx);

    expect(ctx.getOrCreateSession).not.toHaveBeenCalled();
  });

  it('mode property is group-chat', () => {
    const strategy = new GroupChatStrategy(makeConfig());
    expect(strategy.mode).toBe('group-chat');
  });
});
