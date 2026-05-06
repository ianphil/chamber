import type { OrchestrationContext, OrchestrationStrategy } from '../../chatroom/orchestration';
import type { SessionGroupOrchestrator, SessionGroupRunContext } from './types';

// ---------------------------------------------------------------------------
// wrapStrategy — adapt today's OrchestrationStrategy to SessionGroupOrchestrator
// ---------------------------------------------------------------------------

/**
 * Phase 3 compatibility shim: each existing strategy
 * (Concurrent / Sequential / GroupChat / Handoff / Magentic) keeps its
 * `OrchestrationContext`-shaped contract. The wrapper rebuilds an
 * `OrchestrationContext` from the SessionGroup-native run context so
 * SessionGroup.run() can dispatch through the new seam without touching
 * any strategy code.
 *
 * Phase 5 will rewrite strategies to consume `SessionGroupRunContext`
 * directly and this shim goes away.
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
