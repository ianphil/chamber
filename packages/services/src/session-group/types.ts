import type { PermissionHandler } from '@github/copilot-sdk';
import type { CopilotSession } from '../mind';

// ---------------------------------------------------------------------------
// SessionGroupSessionFactory — minimal SDK-shaped contract
// ---------------------------------------------------------------------------

/**
 * Subset of the mind/session factory surface that SessionGroup depends on.
 * Kept narrow on purpose so SessionGroup is portable beyond the chatroom.
 */
export interface SessionGroupSessionFactory {
  createChatroomSession(
    mindId: string,
    onPermissionRequest?: PermissionHandler,
  ): Promise<CopilotSession>;
}

// ---------------------------------------------------------------------------
// PermissionHandlerFactory — caller-supplied policy
// ---------------------------------------------------------------------------

/**
 * Builds a `PermissionHandler` for a given `mindId`. SessionGroup invokes
 * this once per cached session. The implementation owns approval policy
 * (e.g. ApprovalGate gating) — SessionGroup just injects the result into
 * the SDK session at creation time.
 */
export type PermissionHandlerFactory = (mindId: string) => PermissionHandler;
