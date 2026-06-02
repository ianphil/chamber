/**
 * FakeLLMClient — in-memory `LLMClient` for unit tests.
 *
 * Phase 8 ships this so Phase 9 (DreamDaemon) can drive the orchestrator
 * with canned responses keyed by prompt prefix. Co-located under
 * `__fakes__/` because it is intentionally NOT part of the public package
 * surface (`mindMemory/index.ts` re-exports the interface, not this helper).
 */

import type { LLMClient, SynthesizeRequest } from '../LLMClient';

export interface FakeLLMClientOptions {
  /**
   * Map of prompt-prefix → canned response. The longest matching prefix
   * wins so callers can layer specific overrides on top of generic ones.
   */
  readonly responses?: Record<string, string>;
  /** Returned when no prefix matches. Defaults to an empty string. */
  readonly defaultResponse?: string;
  /** Forced rejection; useful for error-path tests. */
  readonly error?: Error;
  /**
   * Artificial latency in ms. The fake honors `timeoutMs` by rejecting
   * with the same shape `CopilotLLMClient` uses, so daemon tests can
   * exercise the timeout branch without a real adapter.
   */
  readonly latencyMs?: number;
}

export interface FakeLLMClient extends LLMClient {
  readonly calls: ReadonlyArray<SynthesizeRequest>;
}

export function createFakeLLMClient(options: FakeLLMClientOptions = {}): FakeLLMClient {
  const calls: SynthesizeRequest[] = [];
  const responses = options.responses ?? {};
  const prefixes = Object.keys(responses).sort((a, b) => b.length - a.length);

  return {
    get calls() {
      return calls;
    },
    async synthesize(req: SynthesizeRequest): Promise<string> {
      calls.push(req);
      if (options.error) throw options.error;

      const latency = options.latencyMs ?? 0;
      if (latency > 0) {
        const timedOut = await new Promise<boolean>((resolve) => {
          const t = setTimeout(() => resolve(false), latency);
          const onTimeout = setTimeout(() => {
            clearTimeout(t);
            resolve(true);
          }, req.timeoutMs);
          t.unref?.();
          onTimeout.unref?.();
        });
        if (timedOut) {
          throw new Error(`LLM synthesis timed out after ${req.timeoutMs}ms`);
        }
      }

      const match = prefixes.find((p) => req.prompt.startsWith(p));
      if (match) return responses[match];
      return options.defaultResponse ?? '';
    },
  };
}
