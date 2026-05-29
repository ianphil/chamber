import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ScriptRunner } from './ScriptRunner';
import { TokenRegistry } from '../automation/TokenRegistry';

let mindPath: string;
let tmpRuntime: string;
let tokens: TokenRegistry;

beforeEach(() => {
  mindPath = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-scriptrunner-'));
  fs.mkdirSync(path.join(mindPath, '.chamber', 'automation'), { recursive: true });
  tmpRuntime = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-fake-runtime-'));
  tokens = new TokenRegistry();
});

afterEach(() => {
  fs.rmSync(mindPath, { recursive: true, force: true });
  fs.rmSync(tmpRuntime, { recursive: true, force: true });
});

function makeRunner(): ScriptRunner {
  // Fake tsx CLI: a JS shim that just executes the script path argv[1] as a Node CommonJS module.
  // Because our test scripts use plain JS (not TS), we can have the shim require() them directly.
  const shim = path.join(tmpRuntime, 'fake-tsx.js');
  fs.writeFileSync(
    shim,
    `const p = process.argv[2]; require(p);\n`,
  );
  return new ScriptRunner({
    bridgeUrl: 'http://127.0.0.1:0',
    tokens,
    resolveRuntime: () => ({
      nodeBinary: process.execPath,
      tsxCli: shim,
      nodePath: '',
    }),
  });
}

function writeScript(content: string, name = 'go.ts'): string {
  // Write as .ts (validateScriptPath enforces extension) but contents are
  // executed by the shim as CommonJS — keep contents in JS syntax.
  const rel = path.join('.chamber', 'automation', name);
  fs.writeFileSync(path.join(mindPath, rel), content);
  return rel;
}

describe('ScriptRunner', () => {
  it('runs a script to completion and mints+revokes its bridge token', async () => {
    const rel = writeScript(`console.log('hello'); process.exit(0);`);
    const runner = makeRunner();
    const before = tokens.size();
    const result = await runner.run({ mindId: 'mind-1', mindPath, scriptPath: rel });
    expect(result.status).toBe('completed');
    expect(result.graphId).toMatch(/[0-9a-f-]{36}/);
    expect(result.output).toContain('hello');
    expect(tokens.size()).toBe(before);
  });

  it('returns failed when the script exits non-zero and captures stderr', async () => {
    const rel = writeScript(`console.error('boom'); process.exit(7);`);
    const runner = makeRunner();
    const result = await runner.run({ mindId: 'mind-1', mindPath, scriptPath: rel });
    expect(result.status).toBe('failed');
    expect(result.error).toContain('boom');
  });

  it('returns timed-out when the script exceeds timeoutMs', async () => {
    const rel = writeScript(`setTimeout(() => {}, 60_000);`);
    const runner = makeRunner();
    const result = await runner.run({ mindId: 'mind-1', mindPath, scriptPath: rel, timeoutMs: 200 });
    expect(result.status).toBe('timed-out');
  });

  it('redacts the bridge token from captured output', async () => {
    const rel = writeScript(`console.log('TOKEN=' + process.env.CHAMBER_BRIDGE_TOKEN); process.exit(0);`);
    const runner = makeRunner();
    const result = await runner.run({ mindId: 'mind-1', mindPath, scriptPath: rel });
    expect(result.output).toContain('TOKEN=');
    expect(result.output).toContain('[REDACTED]');
    expect(result.output).not.toMatch(/TOKEN=[A-Za-z0-9_-]{40,}/);
  });

  it('refuses to spawn a script that fails validateScriptPath', async () => {
    const runner = makeRunner();
    await expect(
      runner.run({ mindId: 'mind-1', mindPath, scriptPath: '../etc/passwd.ts' }),
    ).rejects.toThrow();
  });
});
