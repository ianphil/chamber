import type { OrchestrationContext, OrchestrationStrategy } from './legacy-types';
import type { SessionGroupOrchestrator, SessionGroupRunContext } from './types';

// ---------------------------------------------------------------------------
// wrapStrategy — adapt today's OrchestrationStrategy to SessionGroupOrchestrator
// ---------------------------------------------------------------------------

/**
 * Bridge between the legacy `OrchestrationStrategy` contract (used by every
 * concrete strategy in this folder) and the SessionGroup-native
 * `SessionGroupOrchestrator` contract that `SessionGroup.run()` consumes.
 * Rebuilds an `OrchestrationContext` from the run context so strategies
 * don't need to know about `SessionGroup`.
 *
 * This adapter is intentional and load-bearing — strategies are kept on
 * the legacy contract so their dense, well-tested fakes stay valid. A
 * follow-up PR will rewrite strategies to consume `SessionGroupRunContext`
 * directly and delete this shim.
 */
export function wrapStrategy(strategy: OrchestrationStrategy): SessionGroupOrchestrator {
  return {
    mode: strategy.mode,

    async execute(userMessage, participants, roundId, runContext: SessionGroupRunContext) {
      const ctx: OrchestrationContext = {
        getOrCreateSession: (mindId) => runContext.group.getOrCreateSession(mindId),
        evictSession: (mindId) => runContext.group.evictSession(mindId),
        buildBasePrompt: runContext.product.buildBasePrompt,
        emitEvent: runContext.product.emitEvent,
        persistMessage: runContext.product.persistMessage,
        getHistory: runContext.product.getHistory,
        orchestrationMode: runContext.orchestrationMode,
      };
      await strategy.execute(userMessage, participants, roundId, ctx);
    },

    stop() {
      strategy.stop();
    },
  };
}
