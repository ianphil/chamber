import { describe, it, expect } from 'vitest';
import {
  ChatEventPushSchema,
  MindChangedPushSchema,
  AuthProgressPushSchema,
  GenesisProgressPushSchema,
  ChatroomEventPushSchema,
} from './outbound';

describe('outbound push schemas', () => {
  it('chat:event shape validates', () => {
    expect(
      ChatEventPushSchema.safeParse({
        mindId: 'm1',
        messageId: 'msg1',
        event: { type: 'done' },
      }).success,
    ).toBe(true);
  });

  it('mind:changed validates array of MindRecord', () => {
    expect(MindChangedPushSchema.safeParse([{ id: 'a', path: '/tmp' }]).success).toBe(true);
    expect(MindChangedPushSchema.safeParse(['nope']).success).toBe(false);
  });

  it('auth:progress validates', () => {
    expect(AuthProgressPushSchema.safeParse({ step: 'starting' }).success).toBe(true);
  });

  it('genesis:progress validates', () => {
    expect(GenesisProgressPushSchema.safeParse({ step: 'done', detail: 'ok' }).success).toBe(
      true,
    );
  });

  it('chatroom:event validates', () => {
    expect(
      ChatroomEventPushSchema.safeParse({
        mindId: 'a',
        mindName: 'Aria',
        messageId: 'm1',
        roundId: 'r1',
        event: { type: 'done' },
      }).success,
    ).toBe(true);
  });
});
