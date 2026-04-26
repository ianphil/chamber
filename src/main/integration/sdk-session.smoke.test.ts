import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CopilotClient } from '@github/copilot-sdk';
import { approveAllCompat } from '../services/sdk/approveAllCompat';

const describeIfEnabled = process.env.CHAMBER_REAL_SDK_SMOKE === '1' ? describe : describe.skip;

async function removeDirWithRetry(dirPath: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      fs.rmSync(dirPath, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 9) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

describeIfEnabled('SDK session smoke test', () => {
  let client: CopilotClient | null = null;
  let tempDir = '';
  let logDir = '';

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-sdk-smoke-'));
    logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-sdk-logs-'));
    fs.mkdirSync(path.join(tempDir, '.working-memory'), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, 'SOUL.md'),
      [
        '# Smoke Test Agent',
        '',
        'When asked to read a file, always use the view tool.',
        'Do not use powershell for file reads.',
      ].join('\n'),
      'utf8',
    );
  });

  afterEach(async () => {
    if (client) {
      await client.stop().catch(() => { /* noop */ });
      client = null;
    }

    if (tempDir) await removeDirWithRetry(tempDir);
    if (logDir) await removeDirWithRetry(logDir);
  });

  it('can read a local file with the real CLI view tool', async () => {
    const cliPath = path.join(
      process.cwd(),
      'node_modules',
      '@github',
      `copilot-${process.platform}-${process.arch}`,
      process.platform === 'win32' ? 'copilot.exe' : 'copilot',
    );
    if (!fs.existsSync(cliPath)) {
      throw new Error(`Local Copilot CLI not found at ${cliPath}`);
    }

    const sentinel = `SMOKE_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const memoryPath = path.join(tempDir, '.working-memory', 'memory.md');
    fs.writeFileSync(memoryPath, `${sentinel}\nsecond line\n`, 'utf8');

    client = new CopilotClient({
      cliPath,
      cwd: tempDir,
      logLevel: 'all',
      cliArgs: [
        '--log-dir', logDir,
        '--allow-all-tools',
        '--allow-all-paths',
        '--allow-all-urls',
      ],
    });
    await client.start();

    const auth = await client.getAuthStatus();
    if (!auth.isAuthenticated) {
      throw new Error(`SDK smoke test requires Copilot auth. ${auth.statusMessage ?? ''}`.trim());
    }

    const session = await client.createSession({
      workingDirectory: tempDir,
      availableTools: ['view'],
      onPermissionRequest: approveAllCompat,
      systemMessage: {
        mode: 'append',
        content: 'Use the view tool for file reads and answer with the requested file content only.',
      },
    });
    await session.rpc.permissions.setApproveAll({ enabled: true });

    const toolNamesByCallId = new Map<string, string>();
    const toolExecutions: Array<{ toolName: string; success: boolean; error?: string }> = [];
    const unsubscribeStart = session.on('tool.execution_start', (event) => {
      toolNamesByCallId.set(event.data.toolCallId, event.data.toolName);
    });
    const unsubscribeComplete = session.on('tool.execution_complete', (event) => {
      toolExecutions.push({
        toolName: toolNamesByCallId.get(event.data.toolCallId) ?? 'unknown',
        success: event.data.success,
        error: event.data.error?.message,
      });
    });

    try {
      const response = await session.sendAndWait({
        prompt: [
          `Use the view tool to read this file: ${memoryPath}`,
          'Reply with exactly the first line of the file and nothing else.',
        ].join('\n'),
      }, 120_000);

      const successfulViewCall = toolExecutions.find((execution) => execution.toolName === 'view' && execution.success);
      if (!successfulViewCall) {
        throw new Error(`Expected a successful view call. Tool executions: ${JSON.stringify(toolExecutions)}`);
      }
      expect(response?.data.content).toContain(sentinel);
    } finally {
      unsubscribeStart();
      unsubscribeComplete();
      await session.destroy().catch(() => { /* noop */ });
    }
  }, 120_000);
});
