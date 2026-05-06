export { SessionGroup } from './SessionGroup';
export { createApprovalGatePermissionFactory } from './permission-handler';
export {
  TurnTimeoutError,
  streamAgentTurn,
  sendToAgentWithRetry,
} from './stream-session';
export type {
  StreamAgentOptions,
  StreamAgentResult,
  SendToAgentOptions,
  SendToAgentResult,
} from './stream-session';
export type { PermissionHandlerFactory, SessionGroupSessionFactory } from './types';
export {
  wrapStrategy,
  createStrategy,
  ConcurrentStrategy,
  SequentialStrategy,
  GroupChatStrategy,
  HandoffStrategy,
  MagenticStrategy,
  BaseStrategy,
} from './orchestrators';
export type {
  ProductHooks,
  SessionGroupOrchestrator,
  SessionGroupRunContext,
  SessionGroupRunOptions,
} from './orchestrators';

// Legacy strategy contract retained for the wrapStrategy adapter only.
// New orchestrators should consume `SessionGroupRunContext` directly; the
// follow-up PR will rewrite the strategies and delete these re-exports.
/** @deprecated Use `SessionGroupOrchestrator` from this barrel instead. */
export type { OrchestrationStrategy } from './orchestrators';
/** @deprecated Use `SessionGroupRunContext` from this barrel instead. */
export type { OrchestrationContext } from './orchestrators';

// Product-layer chatroom helpers that moved alongside the strategies.
export { escapeXml, textContent, extractJsonObject, stripControlJson } from './shared';
export { ObservabilityEmitter, redactParameters } from './observability';
export { ApprovalGate } from './approval-gate';
export type {
  ApprovalGateConfig,
  ApprovalGateResult,
  ApprovalHandler,
  ApprovalLogEntry,
} from './approval-gate';
