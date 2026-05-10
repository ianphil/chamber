// `chatroom/orchestration/` no longer holds product-layer modules — strategies,
// stream wiring, prompt helpers, observability, and the approval gate all moved
// under `session-group/` in v0.44.0. The folder remains as a barrel that
// re-exports the migrated modules so existing call sites keep compiling
// without churn. New code should import from `@chamber/services` (the
// `session-group` re-exports) instead of digging into this folder.

export { ObservabilityEmitter, redactParameters } from '../../session-group/observability';
export { ApprovalGate } from '../../session-group/approval-gate';
export type {
  ApprovalGateConfig,
  ApprovalGateResult,
  ApprovalHandler,
  ApprovalLogEntry,
} from '../../session-group/approval-gate';
