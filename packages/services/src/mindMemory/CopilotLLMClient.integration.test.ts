/**
 * Phase 8 — CopilotLLMClient integration test stub.
 *
 * Hermetic by default. Set `CHAMBER_LIVE_SDK=1` (and ensure the Copilot
 * CLI runtime + valid keychain credentials are present) to exercise the
 * adapter against a real one-shot session.
 *
 * Wiring lives in Phase 13 (composition root); this test documents the
 * contract the desktop wiring must satisfy:
 *   - `createOneShotSession` builds a session with NO tools and NO
 *     permission handler.
 *   - The session's `send` resolves with the final assistant text.
 *   - The session is torn down by `close()` so no CLI process leaks.
 */

import { describe, it } from 'vitest';

const liveSdk = process.env.CHAMBER_LIVE_SDK === '1';

describe('CopilotLLMClient — live SDK', () => {
  it.skipIf(!liveSdk)(
    'returns a string containing "pong" for the canonical smoke prompt',
    async () => {
      // Intentionally not implemented in Phase 8. The composition root
      // (Phase 13) supplies the real `createOneShotSession` factory; this
      // stub will be filled in then. Keeping the file in place so the
      // contract is visible at review time.
      throw new Error(
        'TODO(phase-13): wire CopilotLLMClient to the real Copilot SDK and ' +
        'assert synthesize({prompt: "Reply with the word \'pong\' and nothing else.", timeoutMs: 30_000}) ' +
        'returns a string containing "pong".',
      );
    },
  );
});
