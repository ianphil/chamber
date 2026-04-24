/**
 * Detect stale-session errors thrown by the Copilot SDK when the CLI
 * harvests an idle session.  The SDK surfaces these as plain `Error`
 * instances with message `"Session not found: <sessionId>"`.
 */
export function isStaleSessionError(err: unknown): boolean {
  return err instanceof Error && err.message.includes('Session not found');
}

// ---------------------------------------------------------------------------
// Session timeout constants
// ---------------------------------------------------------------------------

/**
 * Max wait for `session.send()` to resolve before we treat the session as
 * dead (e.g. wedged WebSocket, killed CLI subprocess) and trigger the
 * stale-session retry path.  The error message intentionally starts with
 * "Session not found" so {@link isStaleSessionError} matches it.
 */
export const SEND_TIMEOUT_MS = 30_000;

/** Default cap on a single agent turn (i.e. time until `session.idle`). */
export const DEFAULT_TURN_TIMEOUT_MS = 300_000;

/** Build the error thrown when `session.send()` exceeds {@link SEND_TIMEOUT_MS}. */
export function sendTimeoutError(): Error {
  return new Error('Session not found: send() timed out');
}
