/**
 * CopilotLLMClient — `LLMClient` adapter that calls the mind's own Copilot
 * SDK as a one-shot, side-effect-free language model for the Dream Daemon.
 *
 * The adapter intentionally does NOT own SDK lifecycle. It receives a
 * `createOneShotSession` factory through `deps`; that factory (supplied
 * by the composition root in Phase 13) is responsible for constructing a
 * Copilot session with:
 *   - NO tools registered (empty tool surface).
 *   - NO permission handler / no approval flow.
 *   - The provided `AbortSignal` threaded into the SDK so the adapter's
 *     timeout actually cancels the underlying CLI process.
 *
 * The adapter contract enforces the rest:
 *   - One fresh session per `synthesize` call (no history mutation).
 *   - Internal `AbortController` with a `setTimeout(timeoutMs)` deadline.
 *   - The session is closed in `finally`, even on timeout / synthesis
 *     failure, so a stuck CLI cannot leak.
 *   - On timeout, rejects with `Error('LLM synthesis timed out after Xms')`
 *     so callers can distinguish it from SDK / network failures.
 *
 * v1 deliberately does NOT accept an external `AbortSignal` — there is a
 * single internal controller. Callers wanting cancellation should compose
 * a shorter `timeoutMs`.
 */

import type { LLMClient, SynthesizeRequest } from './LLMClient';

export interface OneShotSession {
  /** Resolves with the final assistant text for the prompt. */
  send(prompt: string): Promise<string>;
  /** Best-effort teardown; called in `finally` and must not throw. */
  close(): Promise<void>;
}

export interface CreateOneShotSessionArgs {
  readonly mindId: string;
  readonly mindPath: string;
  readonly signal: AbortSignal;
}

export interface CopilotLLMClientDeps {
  /**
   * Factory that constructs a one-shot Copilot session for the target
   * mind. Implementations MUST disable tools and the permission handler
   * and MUST honor `signal` (abort the underlying CLI on cancel).
   */
  readonly createOneShotSession: (args: CreateOneShotSessionArgs) => Promise<OneShotSession>;
}

export interface CopilotLLMClientOptions {
  readonly mindId: string;
  readonly mindPath: string;
  readonly deps: CopilotLLMClientDeps;
}

export function createCopilotLLMClient(opts: CopilotLLMClientOptions): LLMClient {
  const { mindId, mindPath, deps } = opts;

  return {
    async synthesize(req: SynthesizeRequest): Promise<string> {
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, req.timeoutMs);

      let session: OneShotSession | null = null;
      try {
        session = await deps.createOneShotSession({
          mindId,
          mindPath,
          signal: controller.signal,
        });
        const result = await session.send(req.prompt);
        if (timedOut) {
          throw new Error(`LLM synthesis timed out after ${req.timeoutMs}ms`);
        }
        return result;
      } catch (err) {
        if (timedOut) {
          throw new Error(`LLM synthesis timed out after ${req.timeoutMs}ms`, { cause: err });
        }
        throw err;
      } finally {
        clearTimeout(timer);
        if (session) {
          try {
            await session.close();
          } catch {
            // best-effort teardown
          }
        }
      }
    },
  };
}
