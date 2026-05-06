// Compatibility shim — streamAgentTurn / sendToAgentWithRetry now live under
// the session-group seam. Existing strategies import from this module; once
// the strategies relocate (Phase 5), this shim and these re-exports go away.

export {
  TurnTimeoutError,
  streamAgentTurn,
  sendToAgentWithRetry,
} from '../../session-group/stream-session';

export type {
  StreamAgentOptions,
  StreamAgentResult,
  SendToAgentOptions,
  SendToAgentResult,
} from '../../session-group/stream-session';
