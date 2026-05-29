import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CopilotClient, RuntimeConnection } from '@github/copilot-sdk';

import { createCopilotLLMClient } from './CopilotLLMClient';
import { buildOneShotSession } from './oneShotSession';
import {
  getPlatformCopilotBinaryPath,
  resolveNodeModulesDir,
} from '../sdk';

/**
 * Phase 8 / 13 — CopilotLLMClient × Copilot SDK contract test.
 *
 * Hermetic by default. Set `CHAMBER_LIVE_SDK=1` (and ensure the Copilot
 * CLI runtime + valid keychain credentials are present) to exercise the
 * adapter against a real one-shot session.
 *
 * The unit-test contract for `buildOneShotSession` lives in
 * `oneShotSession.test.ts` (hermetic, fakes only). This file proves the
 * production adapter actually drives the SDK end-to-end with the
 * documented contract:
 *
 *   - NO tools registered (tools = [])
 *   - NO config discovery (`enableConfigDiscovery: false`)
 *   - PermissionHandler refuses any request that leaks through
 *   - `synthesize` returns the final assistant text
 *   - the underlying CLI process is torn down by `close()`
 */

const liveSdk = process.env.CHAMBER_LIVE_SDK === '1';

describe.skipIf(!liveSdk)('CopilotLLMClient — live SDK', () => {
  const mindId = 'chamber-llm-integration-mind';
  let mindPath: string;
  let logDir: string;
  let client: CopilotClient;

  beforeAll(async () => {
    const modulesDir = resolveNodeModulesDir();
    const cliPath = getPlatformCopilotBinaryPath(modulesDir);

    mindPath = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-llm-int-'));
    // SDK --log-dir requires the directory to pre-exist; we don't read logDir again.
    logDir = path.join(os.homedir(), '.chamber', 'logs');
    fs.mkdirSync(logDir, { recursive: true });

    client = new CopilotClient({
      connection: RuntimeConnection.forStdio({
        path: cliPath,
        args: [
          '--log-dir', logDir,
          '--allow-all-tools',
          '--allow-all-paths',
          '--allow-all-urls',
        ],
      }),
      workingDirectory: mindPath,
      logLevel: 'all',
    });
    await client.start();
  }, 60_000);

  afterAll(async () => {
    if (client) {
      await client.stop().catch(() => undefined);
    }
    if (mindPath) {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          fs.rmSync(mindPath, { recursive: true, force: true });
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
    }
  }, 30_000);

  it(
    'returns assistant text containing "pong" for the canonical smoke prompt',
    async () => {
      const llm = createCopilotLLMClient({
        mindId,
        mindPath,
        deps: {
          createOneShotSession: ({ signal }) =>
            buildOneShotSession({
              client,
              workingDirectory: mindPath,
              signal,
            }),
        },
      });

      const response = await llm.synthesize({
        prompt: "Reply with the word 'pong' and nothing else.",
        timeoutMs: 60_000,
      });

      expect(response.toLowerCase()).toContain('pong');
    },
    120_000,
  );
});
