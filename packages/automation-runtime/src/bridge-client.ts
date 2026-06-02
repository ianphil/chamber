/**
 * Thin HTTP client for the Chamber AutomationBridge. Used by handlers that
 * round-trip work back to the main Chamber process (prompt + notify).
 *
 * Configuration comes from env vars injected by `ScriptRunner` at spawn:
 *   CHAMBER_BRIDGE_URL    e.g. "http://127.0.0.1:43117"
 *   CHAMBER_BRIDGE_TOKEN  opaque bearer token, scoped to this run
 *
 * If either env var is missing, calls throw `BridgeUnconfiguredError` —
 * scripts run outside ScriptRunner (e.g. `npx tsx` for local debugging) get
 * a clear error rather than silently no-op'ing.
 */

export class BridgeUnconfiguredError extends Error {
  constructor() {
    super(
      'CHAMBER_BRIDGE_URL / CHAMBER_BRIDGE_TOKEN are not set. '
      + 'This script is not running under Chamber\'s automation runtime.',
    );
    this.name = 'BridgeUnconfiguredError';
  }
}

export class BridgeError extends Error {
  constructor(public readonly status: number, public readonly body: string) {
    super(`Chamber bridge returned ${status}: ${body}`);
    this.name = 'BridgeError';
  }
}

export async function bridgeRequest<TResponse>(
  endpoint: '/prompt' | '/notify',
  body: Record<string, unknown>,
): Promise<TResponse> {
  const url = process.env.CHAMBER_BRIDGE_URL;
  const token = process.env.CHAMBER_BRIDGE_TOKEN;
  const mindId = process.env.CHAMBER_MIND_ID;
  if (!url || !token || !mindId) {
    throw new BridgeUnconfiguredError();
  }
  const response = await fetch(`${url}${endpoint}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ mindId, ...body }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new BridgeError(response.status, text);
  }
  return text ? (JSON.parse(text) as TResponse) : ({} as TResponse);
}
