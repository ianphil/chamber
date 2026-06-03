import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ApprovalGate } from '../../packages/services/src/session-group/approval-gate';

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

  it('cron execution and validation both resolve scripts through validateScriptPath', () => {
    const cronService = fs.readFileSync(path.join(repoRoot, 'packages', 'services', 'src', 'cron', 'CronService.ts'), 'utf8');
    const scriptRunner = fs.readFileSync(path.join(repoRoot, 'packages', 'services', 'src', 'cron', 'ScriptRunner.ts'), 'utf8');

    expect(cronService).toMatch(/createJob\([\s\S]*?validateScriptPath\(mindPath,\s*input\.scriptPath\)/);
    expect(scriptRunner).toMatch(/async run\([\s\S]*?validateScriptPath\(params\.mindPath,\s*params\.scriptPath\)/);
    expect(scriptRunner).toMatch(/async validateScript\([\s\S]*?validateScriptPath\(params\.mindPath,\s*params\.scriptPath\)/);
  });
});
