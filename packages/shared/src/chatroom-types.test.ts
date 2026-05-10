import { describe, it, expect, expectTypeOf } from 'vitest';
import type {
  ChatroomMessage,
  ChatroomTranscript,
  ChatroomStreamEvent,
  ChatroomAPI,
  OrchestrationMode,
  GroupChatConfig,
  OrchestrationEvent,
  OrchestrationEventType,
} from './chatroom-types';
import { isOrchestrationEvent } from './chatroom-types';
import type { ChatMessage, ChatEvent } from './types';

describe('chatroom-types', () => {
  it('ChatroomMessage extends ChatMessage with required sender and roundId', () => {
    expectTypeOf<ChatroomMessage>().toMatchTypeOf<ChatMessage>();
    expectTypeOf<ChatroomMessage['sender']>().toEqualTypeOf<{ mindId: string; name: string }>();
    expectTypeOf<ChatroomMessage['roundId']>().toEqualTypeOf<string>();
  });

  it('ChatroomMessage has optional orchestrationMode', () => {
    expectTypeOf<ChatroomMessage['orchestrationMode']>().toEqualTypeOf<OrchestrationMode | undefined>();
  });

  it('ChatroomTranscript has versioned shape', () => {
    expectTypeOf<ChatroomTranscript['version']>().toEqualTypeOf<1>();
    expectTypeOf<ChatroomTranscript['messages']>().toEqualTypeOf<ChatroomMessage[]>();
  });

  it('ChatroomStreamEvent carries agent identity and event', () => {
    expectTypeOf<ChatroomStreamEvent['mindId']>().toBeString();
    expectTypeOf<ChatroomStreamEvent['mindName']>().toBeString();
    expectTypeOf<ChatroomStreamEvent['messageId']>().toBeString();
    expectTypeOf<ChatroomStreamEvent['roundId']>().toBeString();
  });

  it('ChatroomStreamEvent.event accepts ChatEvent or OrchestrationEvent', () => {
    expectTypeOf<ChatEvent>().toMatchTypeOf<ChatroomStreamEvent['event']>();
    expectTypeOf<OrchestrationEvent>().toMatchTypeOf<ChatroomStreamEvent['event']>();
  });

  it('ChatroomAPI defines the full IPC surface', () => {
    expectTypeOf<ChatroomAPI['send']>().toBeFunction();
    expectTypeOf<ChatroomAPI['history']>().toBeFunction();
    expectTypeOf<ChatroomAPI['clear']>().toBeFunction();
    expectTypeOf<ChatroomAPI['stop']>().toBeFunction();
    expectTypeOf<ChatroomAPI['setOrchestration']>().toBeFunction();
    expectTypeOf<ChatroomAPI['getOrchestration']>().toBeFunction();
    expectTypeOf<ChatroomAPI['onEvent']>().toBeFunction();
  });

  it('OrchestrationMode is a string union of five modes', () => {
    expectTypeOf<'concurrent'>().toMatchTypeOf<OrchestrationMode>();
    expectTypeOf<'sequential'>().toMatchTypeOf<OrchestrationMode>();
    expectTypeOf<'handoff'>().toMatchTypeOf<OrchestrationMode>();
    expectTypeOf<'group-chat'>().toMatchTypeOf<OrchestrationMode>();
    expectTypeOf<'magentic'>().toMatchTypeOf<OrchestrationMode>();
  });

  it('GroupChatConfig has required fields', () => {
    expectTypeOf<GroupChatConfig['moderatorMindId']>().toBeString();
    expectTypeOf<GroupChatConfig['maxTurns']>().toBeNumber();
    expectTypeOf<GroupChatConfig['minRounds']>().toBeNumber();
    expectTypeOf<GroupChatConfig['maxSpeakerRepeats']>().toBeNumber();
  });

  it('OrchestrationEvent has type and data', () => {
    expectTypeOf<OrchestrationEvent['type']>().toEqualTypeOf<OrchestrationEventType>();
    expectTypeOf<OrchestrationEvent['data']>().toMatchTypeOf<Record<string, unknown>>();
  });

  // -------------------------------------------------------------------------
  // isOrchestrationEvent — runtime type guard tests
  // -------------------------------------------------------------------------

  it('isOrchestrationEvent returns true for orchestration:turn-start', () => {
    const event: OrchestrationEvent = { type: 'orchestration:turn-start', data: { speaker: 'A', speakerMindId: 'a1' } };
    expect(isOrchestrationEvent(event)).toBe(true);
  });

  it('isOrchestrationEvent returns true for all orchestration event types', () => {
    const types: OrchestrationEventType[] = [
      'orchestration:turn-start',
      'orchestration:moderator-decision',
      'orchestration:convergence',
      'orchestration:synthesis',
      'orchestration:handoff',
      'orchestration:handoff-terminated',
      'orchestration:magentic-terminated',
      'orchestration:task-ledger-update',
      'orchestration:manager-plan',
      'orchestration:approval-requested',
      'orchestration:approval-decided',
    ];
    for (const type of types) {
      // Use `as any` because not all data shapes match the discriminated members
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(isOrchestrationEvent({ type, data: {} } as any)).toBe(true);
    }
  });

  it('isOrchestrationEvent returns false for ChatEvent types', () => {
    const chatEvents: ChatEvent[] = [
      { type: 'chunk', content: 'hello' },
      { type: 'done' },
      { type: 'error', message: 'fail' },
      { type: 'timeout', timeoutMs: 30_000 },
      { type: 'reconnecting' },
      { type: 'tool_start', toolCallId: 't1', toolName: 'read' },
      { type: 'reasoning', reasoningId: 'r1', content: 'thinking' },
      { type: 'message_final', sdkMessageId: 's1', content: 'final' },
    ];
    for (const event of chatEvents) {
      expect(isOrchestrationEvent(event)).toBe(false);
    }
  });
});
