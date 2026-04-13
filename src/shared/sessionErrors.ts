/**
 * Detect stale-session errors thrown by the Copilot SDK when the CLI
 * harvests an idle session.  The SDK surfaces these as plain `Error`
 * instances with message `"Session not found: <sessionId>"`.
 */
export function isStaleSessionError(err: unknown): boolean {
  return err instanceof Error && err.message.includes('Session not found');
}
