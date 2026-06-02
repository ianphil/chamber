/**
 * One-shot Copilot SDK session adapter for the Dream Daemon.
 *
 * Encapsulates the *contract* a memory-consolidation session must satisfy
 * so callers cannot accidentally weaken it:
 *
 *   - tools = [] (empty surface)
 *   - enableConfigDiscovery = false (no project config leakage)
 *   - systemMessage replaced (the mind's own SOUL.md is not loaded)
 *   - PermissionHandler refuses every request (defense-in-depth — an empty
 *     tool surface should never produce a permission request, but if one
 *     ever leaks through it is denied loudly)
 *   - the caller's AbortSignal aborts the in-flight CLI call
 *   - close() removes the abort listener and disconnects the session
 *
 * The SDK-typed plumbing lives here so both the desktop adapter
 * (apps/desktop/.../buildMindMemoryService.ts) and the live-SDK
 * integration test bind to the *same* session contract.
 */
import type {
  CopilotClient,
  PermissionHandler,
  SessionConfig,
} from '@github/copilot-sdk';

import type { OneShotSession } from './CopilotLLMClient';

const refusingPermissionHandler: PermissionHandler = () => ({
  kind: 'reject',
  feedback: 'Tool permissions are disabled for memory-consolidation sessions.',
});

export interface BuildOneShotSessionArgs {
  readonly client: CopilotClient;
  readonly workingDirectory: string;
  readonly signal: AbortSignal;
  /**
   * Invoked when `close()` swallows a disconnect error. Optional so
   * tests don't have to plumb a logger; production wiring passes a
   * structured-log callback.
   */
  readonly onDisconnectError?: (err: unknown) => void;
}

export async function buildOneShotSession(
  args: BuildOneShotSessionArgs,
): Promise<OneShotSession> {
  const { client, workingDirectory, signal, onDisconnectError } = args;

  const sessionConfig: SessionConfig = {
    workingDirectory,
    enableConfigDiscovery: false,
    tools: [],
    systemMessage: { mode: 'replace', content: '' },
    onPermissionRequest: refusingPermissionHandler,
  };

  const session = await client.createSession(sessionConfig);

  const onAbort = (): void => {
    session.abort().catch(() => { /* best-effort: abort can race with natural completion */ });
  };

  if (signal.aborted) {
    onAbort();
  } else {
    signal.addEventListener('abort', onAbort, { once: true });
  }

  return {
    async send(prompt: string): Promise<string> {
      const event = await session.sendAndWait({ prompt });
      return event?.data.content ?? '';
    },
    async close(): Promise<void> {
      signal.removeEventListener('abort', onAbort);
      try {
        await session.disconnect();
      } catch (err) {
        onDisconnectError?.(err);
      }
    },
  };
}
