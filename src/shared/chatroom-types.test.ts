import { describe, it, expectTypeOf } from 'vitest';
import type { ChatroomMessage, ChatroomTranscript, ChatroomStreamEvent, ChatroomAPI } from './chatroom-types';
import type { ChatMessage } from './types';

describe('chatroom-types', () => {
  it('ChatroomMessage extends ChatMessage with required sender and roundId', () => {
    expectTypeOf<ChatroomMessage>().toMatchTypeOf<ChatMessage>();
    expectTypeOf<ChatroomMessage['sender']>().toEqualTypeOf<{ mindId: string; name: string }>();
    expectTypeOf<ChatroomMessage['roundId']>().toEqualTypeOf<string>();
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

  it('ChatroomAPI defines the full IPC surface', () => {
    expectTypeOf<ChatroomAPI['send']>().toBeFunction();
    expectTypeOf<ChatroomAPI['history']>().toBeFunction();
    expectTypeOf<ChatroomAPI['clear']>().toBeFunction();
    expectTypeOf<ChatroomAPI['stop']>().toBeFunction();
    expectTypeOf<ChatroomAPI['onEvent']>().toBeFunction();
  });
});
