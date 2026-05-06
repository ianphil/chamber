import type { ChatroomMessage, ChatroomStreamEvent, OrchestrationMode } from '@chamber/shared/chatroom-types';
import type { MindContext } from '@chamber/shared/types';
import type { SessionGroup } from '../SessionGroup';

// ---------------------------------------------------------------------------
// ProductHooks — sink for events/persistence/prompt building
// ---------------------------------------------------------------------------

/**
 * Product-shaped callbacks the orchestrator needs that do *not* belong on
 * SessionGroup itself. Phase 3 keeps these in the chatroom-event vocabulary
 * (`ChatroomStreamEvent`, `ChatroomMessage`) so existing strategies adapt
 * without rewriting. Phase 4 introduces a SessionGroup-native event union
 * and the chatroom maps it to the renderer-facing shape.
 */
export interface ProductHooks {
  /** Build the prompt the orchestrator will hand to a participant. */
  buildBasePrompt(userMessage: string, participants: MindContext[], forMind?: MindContext): string;
  /** Emit a chatroom-shaped stream event back to the product layer. */
  emitEvent(event: ChatroomStreamEvent): void;
  /** Persist an assistant message produced by a participant. */
  persistMessage(message: ChatroomMessage): void;
  /** Read the current message history (for prompt building / replay). */
  getHistory(): ChatroomMessage[];
}

// ---------------------------------------------------------------------------
// SessionGroupRunContext — handed to orchestrators by SessionGroup.run()
// ---------------------------------------------------------------------------

/**
 * Per-run context. The `group` reference exposes session lifecycle so
 * orchestrators don't need bespoke get-or-create/evict callbacks; `product`
 * carries everything the chatroom owns.
 */
export interface SessionGroupRunContext {
  readonly group: SessionGroup;
  readonly product: ProductHooks;
  readonly orchestrationMode: OrchestrationMode;
}

// ---------------------------------------------------------------------------
// SessionGroupOrchestrator — what SessionGroup.run() dispatches to
// ---------------------------------------------------------------------------

/**
 * Mirrors today's `OrchestrationStrategy` but driven by `SessionGroup`
 * instead of the ad-hoc `OrchestrationContext`. The existing strategies are
 * adapted via `wrapStrategy` so Phase 3 introduces no behavior change.
 */
export interface SessionGroupOrchestrator {
  readonly mode: OrchestrationMode;

  execute(
    userMessage: string,
    participants: MindContext[],
    roundId: string,
    runContext: SessionGroupRunContext,
  ): Promise<void>;

  stop(): void;
}

// ---------------------------------------------------------------------------
// SessionGroupRunOptions — argument to SessionGroup.run()
// ---------------------------------------------------------------------------

export interface SessionGroupRunOptions {
  readonly prompt: string;
  readonly participants: MindContext[];
  readonly roundId: string;
  readonly orchestrator: SessionGroupOrchestrator;
  readonly product: ProductHooks;
}
