import { describe, it, expectTypeOf } from 'vitest';
import type {
  SquadAPI,
  SquadAgentSummary,
  SquadDecisionSummary,
  SquadRoomEvent,
  SquadRoomMessage,
  SquadRoomMessageSender,
  SquadRoomSnapshot,
  SquadRoomStatus,
  SquadRoomTranscript,
  SquadRoutingRule,
  SquadSendRequest,
  SquadSendResult,
} from './squad-types';

describe('squad-types', () => {
  it('SquadRoomStatus is the supported room state union', () => {
    expectTypeOf<'unselected'>().toMatchTypeOf<SquadRoomStatus>();
    expectTypeOf<'missing'>().toMatchTypeOf<SquadRoomStatus>();
    expectTypeOf<'ready'>().toMatchTypeOf<SquadRoomStatus>();
    expectTypeOf<'error'>().toMatchTypeOf<SquadRoomStatus>();
  });

  it('SquadRoomSnapshot exposes read-only room state', () => {
    expectTypeOf<SquadRoomSnapshot['repoPath']>().toEqualTypeOf<string | null>();
    expectTypeOf<SquadRoomSnapshot['squadPath']>().toEqualTypeOf<string | null>();
    expectTypeOf<SquadRoomSnapshot['status']>().toEqualTypeOf<SquadRoomStatus>();
    expectTypeOf<SquadRoomSnapshot['coordinator']>().toEqualTypeOf<SquadAgentSummary | null>();
    expectTypeOf<SquadRoomSnapshot['agents']>().toEqualTypeOf<SquadAgentSummary[]>();
    expectTypeOf<SquadRoomSnapshot['routingRules']>().toEqualTypeOf<SquadRoutingRule[]>();
    expectTypeOf<SquadRoomSnapshot['decisions']>().toEqualTypeOf<SquadDecisionSummary[]>();
  });

  it('SquadRoomMessage carries sender, turn, and content', () => {
    expectTypeOf<SquadRoomMessage['sender']>().toEqualTypeOf<SquadRoomMessageSender>();
    expectTypeOf<SquadRoomMessage['turnId']>().toEqualTypeOf<string | null>();
    expectTypeOf<SquadRoomMessage['content']>().toBeString();
    expectTypeOf<SquadRoomMessageSender['kind']>().toEqualTypeOf<'user' | 'chamber-mind' | 'squad-coordinator' | 'squad-agent' | 'system'>();
  });

  it('SquadRoomTranscript is versioned per room', () => {
    expectTypeOf<SquadRoomTranscript['version']>().toEqualTypeOf<1>();
    expectTypeOf<SquadRoomTranscript['messages']>().toEqualTypeOf<SquadRoomMessage[]>();
  });

  it('SquadSendRequest targets a room and optional agent', () => {
    expectTypeOf<SquadSendRequest['roomId']>().toBeString();
    expectTypeOf<SquadSendRequest['repoPath']>().toBeString();
    expectTypeOf<SquadSendRequest['prompt']>().toBeString();
    expectTypeOf<SquadSendRequest['targetAgentName']>().toEqualTypeOf<string | undefined>();
  });

  it('SquadSendResult is success or typed failure', () => {
    expectTypeOf<Extract<SquadSendResult, { success: true }>['message']>().toEqualTypeOf<SquadRoomMessage>();
    expectTypeOf<Extract<SquadSendResult, { success: false }>['reason']>().toEqualTypeOf<'desktop-only' | 'room-not-ready' | 'busy' | 'runner-unavailable' | 'canceled' | 'timeout' | 'failed'>();
  });

  it('SquadRoomEvent supports streaming and failure events', () => {
    expectTypeOf<Extract<SquadRoomEvent, { type: 'message-delta' }>['delta']>().toBeString();
    expectTypeOf<Extract<SquadRoomEvent, { type: 'error' }>['message']>().toBeString();
    expectTypeOf<Extract<SquadRoomEvent, { type: 'canceled' }>['turnId']>().toBeString();
  });

  it('SquadAPI defines room loading and bridge messaging surfaces', () => {
    expectTypeOf<SquadAPI['selectRepository']>().toBeFunction();
    expectTypeOf<SquadAPI['getRoom']>().toBeFunction();
    expectTypeOf<SquadAPI['history']>().toBeFunction();
    expectTypeOf<SquadAPI['send']>().toBeFunction();
    expectTypeOf<SquadAPI['stop']>().toBeFunction();
    expectTypeOf<SquadAPI['clear']>().toBeFunction();
    expectTypeOf<SquadAPI['onEvent']>().toBeFunction();
  });
});
