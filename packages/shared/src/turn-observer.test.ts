import { describe, it, expectTypeOf } from 'vitest';
import type {
  CompletedTurn,
  TurnCompletionObserver,
  TurnStatus,
} from './turn-observer';

describe('turn-observer types', () => {
  it('TurnStatus is a closed union of completed | aborted | error', () => {
    expectTypeOf<TurnStatus>().toEqualTypeOf<'completed' | 'aborted' | 'error'>();
  });

  it('CompletedTurn contains the full payload required by Phase 6', () => {
    const turn: CompletedTurn = {
      turnId: 't-1',
      sessionId: 's-1',
      model: 'm-1',
      status: 'completed',
      startedAt: '2026-05-12T17:00:00.000Z',
      endedAt: '2026-05-12T17:00:01.000Z',
      prompt: 'hello',
      finalAssistantMessage: 'hi back',
    };
    expectTypeOf(turn.turnId).toBeString();
    expectTypeOf(turn.sessionId).toBeString();
    expectTypeOf(turn.model).toBeString();
    expectTypeOf(turn.status).toEqualTypeOf<TurnStatus>();
    expectTypeOf(turn.startedAt).toBeString();
    expectTypeOf(turn.endedAt).toBeString();
    expectTypeOf(turn.prompt).toBeString();
    expectTypeOf(turn.finalAssistantMessage).toBeString();
  });

  it('TurnCompletionObserver.onTurnCompleted may be sync or async', () => {
    const sync: TurnCompletionObserver = { onTurnCompleted: () => undefined };
    const async: TurnCompletionObserver = { onTurnCompleted: async () => undefined };
    expectTypeOf(sync.onTurnCompleted).parameter(0).toEqualTypeOf<CompletedTurn>();
    expectTypeOf(async.onTurnCompleted).parameter(0).toEqualTypeOf<CompletedTurn>();
    expectTypeOf(sync.onTurnCompleted).returns.toEqualTypeOf<void | Promise<void>>();
  });
});
