import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ApprovalGate } from '../../packages/services/src/session-group/approval-gate';
import { ObservabilityEmitter } from '../../packages/services/src/session-group/observability';
import { AutomationBridge } from '../../packages/services/src/automation/AutomationBridge';
import { TokenRegistry } from '../../packages/services/src/automation/TokenRegistry';

const repoRoot = process.cwd();

describe('security boundary invariants', () => {
  it('mind popout windows keep context isolation on and node integration off', () => {
    const source = fs.readFileSync(path.join(repoRoot, 'apps', 'desktop', 'src', 'main', 'ipc', 'mind.ts'), 'utf8');
    const webPreferences = source.match(/webPreferences:\s*\{(?<body>[\s\S]*?)\n\s*\}/)?.groups?.body;

    expect(webPreferences).toBeDefined();
    expect(webPreferences).toMatch(/\bcontextIsolation:\s*true\b/);
    expect(webPreferences).toMatch(/\bnodeIntegration:\s*false\b/);
    expect(webPreferences).toMatch(/\bsandbox:\s*false\b/);
  });

  it('side-effect tools are default-denied when no approval handler is registered', async () => {
    const gate = new ApprovalGate();

    const result = await gate.gate('agent-1', 'delete_resource', { id: 'danger' }, 'cleanup');

    expect(result.approved).toBe(false);
    expect(result.reason).toMatch(/No approval handler/);
  });

  it('approval and tool observability redact sensitive parameters before logging', async () => {
    const gate = new ApprovalGate({ demoMode: true });
    await gate.gate('agent-1', 'send_email', {
      password: 'plain-secret',
      token: 'plain-token',
      body: 'private message body',
      to: 'user@example.com',
    }, 'send update');

    const audit = gate.getAuditLog()[0];
    expect(audit.request.parameters).toMatchObject({
      password: '[REDACTED]',
      token: '[REDACTED]',
      body: '[REDACTED]',
      to: 'user@example.com',
    });

    const obs = new ObservabilityEmitter('handoff');
    const events: unknown[] = [];
    obs.on((event) => events.push(event));
    obs.toolCallAttempted('agent-1', 'post_message', {
      authorization: 'Bearer secret',
      content: 'private content',
      channel: 'general',
    });

    const attempted = events[0] as { data: { parameters: Record<string, unknown> } };
    expect(attempted.data.parameters).toMatchObject({
      authorization: '[REDACTED]',
      content: '[REDACTED]',
      channel: 'general',
    });
  });

  it('credential writes stay behind credential-store ports instead of app config or mind files', () => {
    const productionFiles = [
      ...walkSourceFiles(path.join(repoRoot, 'apps')),
      ...walkSourceFiles(path.join(repoRoot, 'packages')),
    ].filter((filePath) => !/\.(test|spec)\.tsx?$/.test(filePath));
    const allowedSetPasswordFiles = new Set([
      path.join(repoRoot, 'apps', 'desktop', 'src', 'main', 'ipc', 'a2a.ts'),
      path.join(repoRoot, 'apps', 'server', 'src', 'bin.ts'),
      path.join(repoRoot, 'apps', 'server', 'src', 'privileged-protocol.ts'),
      path.join(repoRoot, 'packages', 'services', 'src', 'auth', 'AuthService.ts'),
      path.join(repoRoot, 'packages', 'services', 'src', 'byo-llm', 'ByoLlmStore.ts'),
      path.join(repoRoot, 'packages', 'services', 'src', 'ports.ts'),
    ]);
    const violations = productionFiles.flatMap((filePath) => {
      const source = fs.readFileSync(filePath, 'utf8');
      if (!source.includes('setPassword(')) return [];
      return allowedSetPasswordFiles.has(filePath)
        ? []
        : [`${path.relative(repoRoot, filePath)} writes credentials outside the approved credential-store boundary`];
    });

    expect(violations).toEqual([]);
  });

  it('automation bridge tokens are per-run and revoked explicitly', () => {
    const tokens = new TokenRegistry();
    const first = tokens.mint('mind-1', 'run-1');
    const second = tokens.mint('mind-1', 'run-2');

    expect(first.token).not.toBe(second.token);
    expect(tokens.verify(first.token)).toEqual({ mindId: 'mind-1', runId: 'run-1' });
    expect(tokens.verify(second.token)).toEqual({ mindId: 'mind-1', runId: 'run-2' });

    tokens.revoke(first.token);
    expect(tokens.verify(first.token)).toBeNull();
    expect(tokens.verify(second.token)).toEqual({ mindId: 'mind-1', runId: 'run-2' });

    tokens.revokeRun('run-2');
    expect(tokens.verify(second.token)).toBeNull();
    expect(tokens.size()).toBe(0);
  });

  it('automation bridge binds to loopback and rejects mind-id mismatch', async () => {
    const bridge = new AutomationBridge({
      onPrompt: async () => ({ text: 'ok' }),
      onNotify: async () => undefined,
    });
    const started = await bridge.start();
    try {
      expect(started.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      const minted = bridge.tokens.mint('mind-1', 'run-1');
      const response = await fetch(`${started.url}/prompt`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${minted.token}`,
        },
        body: JSON.stringify({ mindId: 'mind-2', prompt: 'hello' }),
      });

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'mind-mismatch' });
    } finally {
      await started.stop();
    }
  });

  it('startup never awaits SDK prewarm before creating the main window', () => {
    const source = fs.readFileSync(path.join(repoRoot, 'apps', 'desktop', 'src', 'main.ts'), 'utf8');
    const readyHandler = source.match(/app\.on\('ready', async \(\) => \{(?<body>[\s\S]*?)\n\}\);/)?.groups?.body;

    expect(readyHandler).toBeDefined();
    expect(readyHandler).toContain('void chamberCopilotService.prewarm();');
    expect(readyHandler).not.toMatch(/await\s+chamberCopilotService\.prewarm\(/);
    expect(readyHandler!.indexOf('void chamberCopilotService.prewarm();')).toBeLessThan(
      readyHandler!.indexOf('createWindow();'),
    );
  });

  it('mind tool providers are registered before startup restores sessions', () => {
    const source = fs.readFileSync(path.join(repoRoot, 'apps', 'desktop', 'src', 'main.ts'), 'utf8');

    const providerConstruction = source.indexOf('const mindToolProviders: ChamberToolProvider[]');
    const providerRegistration = source.indexOf('mindManager.setProviders(mindToolProviders);');
    const restoreCall = source.indexOf('mindManager.restoreFromConfig()');

    expect(providerConstruction).toBeGreaterThan(-1);
    expect(providerRegistration).toBeGreaterThan(providerConstruction);
    expect(providerRegistration).toBeLessThan(restoreCall);
  });

  it('script runner redacts bridge tokens from captured output and errors', () => {
    const source = fs.readFileSync(path.join(repoRoot, 'packages', 'services', 'src', 'cron', 'ScriptRunner.ts'), 'utf8');

    expect(source).toMatch(/sanitizeOutput\(stdout,\s*truncatedOut,\s*minted\.token\)/);
    expect(source).toMatch(/sanitizeOutput\(stderr \|\| `Script exited with code \$\{exitCode\}`,\s*truncatedErr,\s*minted\.token\)/);
  });

  it('managed core skills stay lens automation and ttasks from the default marketplace only', () => {
    const managedService = fs.readFileSync(path.join(repoRoot, 'packages', 'services', 'src', 'skills', 'ManagedSkillService.ts'), 'utf8');
    const catalog = fs.readFileSync(path.join(repoRoot, 'packages', 'services', 'src', 'skills', 'MarketplaceSkillCatalog.ts'), 'utf8');

    expect(managedService).toContain("const CORE_SKILL_IDS = new Set(['lens', 'automation', 'ttasks']);");
    expect(catalog).toContain("const RESERVED_CORE_SKILL_IDS = new Set(['lens', 'automation', 'ttasks']);");
    expect(catalog).toMatch(/reserved && marketplaceId\(source\) !== DEFAULT_CORE_SKILL_MARKETPLACE_ID/);
  });

  it('cron job schema remains script-path based and does not reintroduce inline shell jobs', () => {
    const source = fs.readFileSync(path.join(repoRoot, 'packages', 'services', 'src', 'cron', 'types.ts'), 'utf8');
    const cronJob = source.match(/export interface CronJob \{(?<body>[\s\S]*?)\n\}/)?.groups?.body;
    const createInput = source.match(/export interface CreateCronJobInput \{(?<body>[\s\S]*?)\n\}/)?.groups?.body;

    expect(cronJob).toBeDefined();
    expect(createInput).toBeDefined();
    expect(cronJob).toContain('scriptPath: string;');
    expect(createInput).toContain('scriptPath: string;');
    for (const forbidden of ['type:', 'command:', 'shell:', 'prompt:', 'webhook:', 'notification:']) {
      expect(cronJob).not.toContain(forbidden);
      expect(createInput).not.toContain(forbidden);
    }
  });

  it('cron execution and validation both resolve scripts through validateScriptPath', () => {
    const cronService = fs.readFileSync(path.join(repoRoot, 'packages', 'services', 'src', 'cron', 'CronService.ts'), 'utf8');
    const scriptRunner = fs.readFileSync(path.join(repoRoot, 'packages', 'services', 'src', 'cron', 'ScriptRunner.ts'), 'utf8');

    expect(cronService).toMatch(/createJob\([\s\S]*?validateScriptPath\(mindPath,\s*input\.scriptPath\)/);
    expect(scriptRunner).toMatch(/async run\([\s\S]*?validateScriptPath\(params\.mindPath,\s*params\.scriptPath\)/);
    expect(scriptRunner).toMatch(/async validateScript\([\s\S]*?validateScriptPath\(params\.mindPath,\s*params\.scriptPath\)/);
  });
});

function walkSourceFiles(root: string): string[] {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) return walkSourceFiles(fullPath);
    return /\.(ts|tsx)$/.test(entry.name) ? [fullPath] : [];
  });
}
