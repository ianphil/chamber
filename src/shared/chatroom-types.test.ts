import { describe, it, expectTypeOf } from 'vitest';
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
    expectTypeOf<OrchestrationEvent['data']>().toEqualTypeOf<Record<string, unknown>>();
  });
});
