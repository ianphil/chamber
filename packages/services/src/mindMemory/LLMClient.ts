/**
 * LLMClient — minimal language-model synthesis port used by the Dream
 * Daemon (Phase 9) to call a one-shot, side-effect-free LLM.
 *
 * Why an interface (not a concrete class)?
 *   - The daemon's unit tests inject canned responses via a fake
 *     implementation (see `FakeLLMClient`).
 *   - The production wiring (Phase 13) supplies `CopilotLLMClient`, which
 *     uses the mind's own Copilot SDK with tools disabled and no
 *     permission handler so the synthesis cannot pollute the user's
 *     conversation, mutate session history, or trigger UI approvals.
 *
 * Public surface deliberately stays tiny: a single `synthesize` call
 * returning the final assistant text. Streaming, retries, and token
 * accounting are caller concerns and live above this seam.
 */

export interface SynthesizeRequest {
  /** Full prompt text. The adapter does not prepend a system message. */
  readonly prompt: string;
  /** Soft cap; adapters may translate to an SDK-specific limit or ignore. */
  readonly maxTokens?: number;
  /**
   * Hard cap enforced by the adapter via an internal `AbortController`.
   * On expiry, `synthesize` rejects with an Error whose message starts
   * with "LLM synthesis timed out after".
   */
  readonly timeoutMs: number;
}

export interface LLMClient {
  synthesize(req: SynthesizeRequest): Promise<string>;
}
