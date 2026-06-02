/**
 * Shared turn-completion contract.
 *
 * Phase 6 of the Dream Daemon spike pulled `CompletedTurn` out of
 * `@chamber/services/mindMemory/StructuredLogFormat` and into shared so that
 * ChatService (the producer) and DailyLogWriter (the first consumer) depend
 * on a single canonical shape rather than each maintaining its own copy.
 *
 * The corresponding observer interface is defined here too so any future
 * observer (e.g. DreamDaemon's TurnRecorder, A2A task tracker) imports the
 * same protocol from shared.
 */

export type TurnStatus = 'completed' | 'aborted' | 'error';

export interface CompletedTurn {
  readonly turnId: string;
  readonly sessionId: string;
  readonly model: string;
  readonly status: TurnStatus;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly prompt: string;
  readonly finalAssistantMessage: string;
}

/**
 * Observer notified when ChatService finishes a turn successfully.
 *
 * Contract:
 *   - Called once per turn that reached the SDK `done` state. NOT called when
 *     the turn was aborted by the user or errored out.
 *   - Implementations must not throw across the boundary in a way that blocks
 *     other observers — ChatService wraps each call in try/catch and forwards
 *     async failures to its `Logger.warn`. Observer latency must not gate
 *     subsequent turns or surface back into the streaming path.
 */
export interface TurnCompletionObserver {
  onTurnCompleted(turn: CompletedTurn): void | Promise<void>;
}
