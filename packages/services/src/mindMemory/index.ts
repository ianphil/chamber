/**
 * Public surface for the per-mind background memory consolidation engine
 * (a.k.a. "Dream Daemon").
 *
 * Phase 0 scaffold only — no exports yet. Subsequent phases will add:
 *   - pure modules: memory-limits, date-utils, consolidation-priorities,
 *     memory-entries, consolidation, extraction
 *   - I/O: MindMemoryVault, MindArchiveStore, StructuredLogFormat,
 *     DailyLogWriter
 *   - state: dream-schema, dream-state, dream-gates, scheduler
 *   - orchestrator: LLMClient, CopilotLLMClient, DreamDaemon,
 *     InternalScheduler, MindMemoryService
 *
 * See plan: feature/dream-daemon-memory-consolidation.
 */

export const MIND_MEMORY_PACKAGE_VERSION = '0.0.0-scaffold';

export * from './memory-limits';
export * from './date-utils';
export * from './memory-entries';
export * from './consolidation-priorities';
export * from './consolidation';
export * from './extraction';
export * from './StructuredLogFormat';
export * from './MindMemoryVault';
export * from './MindArchiveStore';
export * from './DailyLogWriter';
export * from './dream-schema';
export * from './dream-state';
export * from './dream-gates';
export * from './consolidation-scheduler';
export * from './LLMClient';
export * from './CopilotLLMClient';
export * from './oneShotSession';
export * from './DreamDaemon';
export * from './InternalScheduler';
export * from './MindMemoryService';
